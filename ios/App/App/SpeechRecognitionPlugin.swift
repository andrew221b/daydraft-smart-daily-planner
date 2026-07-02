//
//  SpeechRecognitionPlugin.swift
//  App
//
//  Hand-vendored copy of @capacitor-community/speech-recognition's iOS
//  implementation (MIT, ios/Plugin/Plugin.swift in the npm package) — NOT
//  pulled in via SPM/CocoaPods.
//
//  WHY THIS FILE EXISTS instead of just `npm install`-ing the plugin and
//  letting Capacitor wire it up: this project's iOS dependencies are 100%
//  Swift Package Manager (see ios/App/CapApp-SPM/Package.swift — there is no
//  Podfile/.xcworkspace). The npm package ships ONLY a CocoaPods .podspec, no
//  Package.swift, so `npx cap sync` silently drops it from CapApp-SPM's
//  dependency list (logged as a warning, easy to miss) and its native code
//  never gets compiled in — the JS side would throw "plugin not implemented"
//  at runtime despite `cap sync` listing it as "found".
//
//  Fix: treat it exactly like this project's other hand-written native
//  plugin (see LiveActivityPlugin.swift) — vendor the Swift source straight
//  into the App target and register it manually. Functionally identical to
//  the upstream plugin; only the registration mechanism changed (modern
//  CAPBridgedPlugin + registerPluginInstance, see ViewController.swift,
//  instead of the upstream's legacy CAP_PLUGIN ObjC macro file, which this
//  project doesn't use).
//
//  Capacitor 8 convention (see LiveActivityPlugin.swift): @objc name and
//  `identifier` MUST equal this Swift class's name, NOT the JS-side name —
//  the bridge looks plugins up by class name at runtime. `jsName` below is
//  what matches the JS package's `registerPlugin('SpeechRecognition', ...)`.
//

import Foundation
import Capacitor
import Speech
import AVFAudio

@objc(SpeechRecognitionPlugin)
public class SpeechRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "SpeechRecognitionPlugin"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSupportedLanguages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    ]

    let defaultMatches = 5
    let messageMissingPermission = "Missing permission"
    let messageAccessDeniedMicrophone = "User denied access to microphone"
    let messageOngoing = "Ongoing speech recognition"
    let messageUnknown = "Unknown error occured"

    private var speechRecognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    // ── Continuous dictation (this app's addition) ────────────────────────────
    // Upstream tore the whole engine down on the FIRST `result.isFinal` (which
    // fires after a short pause), so the mic died mid-dump and the JS UI flipped
    // to idle with only the first phrase captured. To match "tap → speak with
    // pauses → tap stop", we keep the audio engine + tap RUNNING and just spin up
    // a fresh recognition task each time one finalises, accumulating the text.
    private var continuousMode = false
    private var stoppedByUser = false
    private var startedEmitted = false   // emit "started"/"stopped" once per session
    private var sessionText = ""          // committed text across restarts
    private var partialResults = false
    private var maxResults = 5
    private var contextualStrings: [String] = []
    private var consecutiveRestarts = 0   // guard against an instant error-restart loop
    private var lastRestartAt: TimeInterval = 0  // timestamp of the last restart (spin detection)
    private var taskRetired = false       // the current recognition task has already finished — ignore trailing callbacks
    // `supportsOnDeviceRecognition` reports whether the OS COULD do on-device for a
    // locale — not whether that locale's model is actually downloaded on THIS
    // device. When it isn't, every task errors out instantly with no transcript,
    // which used to read as "tap mic -> flash -> dead" with no way to recover for
    // the rest of the session. Sticky per-session: the first time an on-device task
    // errors before producing any text, every later restart in this session falls
    // back to server-based recognition instead of retrying the same broken path.
    private var onDeviceUnavailable = false

    @objc func available(_ call: CAPPluginCall) {
        guard let recognizer = SFSpeechRecognizer() else {
            call.resolve(["available": false])
            return
        }
        call.resolve(["available": recognizer.isAvailable])
    }

    @objc func start(_ call: CAPPluginCall) {
        // Defensive: if a previous session didn't fully tear down, clean it now
        // instead of rejecting with "ongoing" — that rejection is what surfaced in
        // JS as the intermittent "Couldn't start dictation".
        if self.audioEngine != nil {
            self.teardown(emitStopped: false)
        }

        let status: SFSpeechRecognizerAuthorizationStatus = SFSpeechRecognizer.authorizationStatus()
        if status != .authorized {
            call.reject(self.messageMissingPermission)
            return
        }

        AVAudioApplication.requestRecordPermission { (granted) in
            if !granted {
                call.reject(self.messageAccessDeniedMicrophone)
                return
            }
            // Audio-engine work must run on the main thread (the permission
            // callback lands on an arbitrary queue).
            DispatchQueue.main.async {
                self.beginSession(call)
            }
        }
    }

    private func beginSession(_ call: CAPPluginCall) {
        let language: String = call.getString("language") ?? "en-US"
        self.maxResults = call.getInt("maxResults") ?? self.defaultMatches
        self.partialResults = call.getBool("partialResults") ?? false
        self.continuousMode = call.getBool("continuous") ?? false
        self.contextualStrings = call.getArray("contextualStrings", String.self) ?? []
        self.stoppedByUser = false
        self.startedEmitted = false
        self.sessionText = ""
        self.consecutiveRestarts = 0
        self.lastRestartAt = 0
        self.onDeviceUnavailable = false

        if self.recognitionTask != nil {
            self.recognitionTask?.cancel()
            self.recognitionTask = nil
        }

        self.audioEngine = AVAudioEngine()
        self.speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: language))

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, options: .defaultToSpeaker)
            try audioSession.setMode(.default)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.teardown(emitStopped: false)
            call.reject("Microphone is already in use by another application.")
            return
        }

        guard let engine = self.audioEngine, self.speechRecognizer != nil else {
            self.teardown(emitStopped: false)
            call.reject(self.messageUnknown)
            return
        }
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        // One persistent tap for the whole session — it appends to whichever
        // recognitionRequest is current, so it survives continuous restarts.
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { (buffer, _) in
            self.recognitionRequest?.append(buffer)
        }

        self.installRecognitionTask()

        engine.prepare()
        do {
            try engine.start()
            if !self.startedEmitted {
                self.startedEmitted = true
                self.notifyListeners("listeningState", data: ["status": "started"])
            }
            if self.partialResults {
                call.resolve()
            }
        } catch {
            self.teardown(emitStopped: false)
            call.reject(self.messageUnknown)
        }
    }

    // Create + start ONE recognition task against the (already running) engine.
    // Reused on every continuous restart; sessionText / engine / tap persist across
    // them. Configures the request the same way each time (dictation hint,
    // punctuation, contextual strings, on-device).
    private func installRecognitionTask() {
        guard let recognizer = self.speechRecognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = self.partialResults
        // .dictation tells Apple's model this is free-form speech (not a short
        // command/search) — measurably better for multi-sentence dumps.
        request.taskHint = .dictation
        if #available(iOS 16.0, *) {
            request.addsPunctuation = true
        }
        if !self.contextualStrings.isEmpty {
            request.contextualStrings = self.contextualStrings
        }
        // Prefer fully on-device recognition when the locale supports it (private,
        // offline, faster start) — UNLESS this session already proved on-device
        // doesn't actually work here (model not downloaded for this locale despite
        // `supportsOnDeviceRecognition` saying yes), in which case we've fallen
        // back to the server for the rest of this session.
        let usingOnDevice = recognizer.supportsOnDeviceRecognition && !self.onDeviceUnavailable
        if usingOnDevice {
            request.requiresOnDeviceRecognition = true
        }
        self.recognitionRequest = request
        self.taskRetired = false

        self.recognitionTask = recognizer.recognitionTask(with: request) { (result, error) in
            // A finished task can deliver a trailing error callback AFTER it has
            // already delivered isFinal (and a single callback can carry BOTH a
            // final result and an error). Without this guard restartOrFinish fires
            // twice for one finalisation, spinning up duplicate recognition tasks
            // that cascade restarts until the spin-guard tears the whole session
            // down ~1s in — the "listening flashed then died" bug.
            if self.taskRetired { return }
            var finish = false
            if let result = result {
                let current = result.bestTranscription.formattedString
                if !current.isEmpty { self.consecutiveRestarts = 0 }
                if self.partialResults {
                    // Always emit the FULL transcript-so-far (committed + current).
                    // Committed segments are joined by newlines: each segment is a
                    // post-pause utterance, so a line break is the natural boundary
                    // and gives the downstream task-splitter cleaner per-item lines.
                    let full = self.sessionText.isEmpty
                        ? current
                        : (current.isEmpty ? self.sessionText : self.sessionText + "\n" + current)
                    self.notifyListeners("partialResults", data: ["matches": [full]])
                }
                if result.isFinal {
                    if !current.isEmpty {
                        self.sessionText = self.sessionText.isEmpty ? current : self.sessionText + "\n" + current
                    }
                    finish = true
                }
            }
            // A benign end-of-segment error in continuous mode = the user paused;
            // restartOrFinish keeps the session alive. Otherwise it finishes.
            if let error = error {
                // Nothing transcribed yet (this task AND every prior one this
                // session) + we were forcing on-device = the on-device model for
                // this locale almost certainly isn't actually available, and every
                // future restart would just fail the same way instantly. Fall back
                // to server-based recognition starting with the very next restart.
                if usingOnDevice && self.sessionText.isEmpty {
                    NSLog("[SpeechRecognition] on-device task errored with no transcript yet (%@) — falling back to server-based recognition for the rest of this session", error.localizedDescription)
                    self.onDeviceUnavailable = true
                }
                finish = true
            }
            if finish {
                self.taskRetired = true
                self.restartOrFinish()
            }
        }
    }

    // After a task finalises (or errors): in continuous mode, start a fresh task on
    // the SAME engine to keep listening; otherwise tear the session down cleanly.
    private func restartOrFinish() {
        if self.continuousMode && !self.stoppedByUser {
            // Spin detection is TIME-BASED, not a flat count. Only restarts that
            // come hard on the heels of the previous one (<0.5s apart) count as an
            // error spin; a restart after a real speaking pause resets the counter.
            // The old fixed `> 6` had no time basis, so a handful of natural pauses
            // (or empty finalisations while the user gathered their thoughts) tore
            // the mic down mid-dictation.
            let now = Date().timeIntervalSince1970
            if now - self.lastRestartAt < 0.5 {
                self.consecutiveRestarts += 1
            } else {
                self.consecutiveRestarts = 0
            }
            self.lastRestartAt = now
            if self.consecutiveRestarts > 8 {
                DispatchQueue.main.async { self.teardown(emitStopped: true) }
                return
            }
            // Cancel (not just drop) the finished task so it can't deliver another
            // trailing callback into the new task's lifetime.
            self.recognitionTask?.cancel()
            self.recognitionTask = nil
            self.recognitionRequest = nil
            // Re-arm on the main thread, only if the engine is still up and the
            // user hasn't stopped in the meantime.
            DispatchQueue.main.async {
                if self.stoppedByUser || self.audioEngine == nil { return }
                self.installRecognitionTask()
            }
            return
        }
        DispatchQueue.main.async { self.teardown(emitStopped: true) }
    }

    // Single, idempotent teardown — cancels the task, stops the engine, removes the
    // tap, deactivates the audio session, and emits "stopped" ONCE (only if the
    // session had emitted "started"). Safe to call from any state.
    private func teardown(emitStopped: Bool) {
        if let task = self.recognitionTask {
            task.cancel()
            self.recognitionTask = nil
        }
        self.recognitionRequest?.endAudio()
        self.recognitionRequest = nil
        if let engine = self.audioEngine {
            if engine.isRunning { engine.stop() }
            engine.inputNode.removeTap(onBus: 0)
            self.audioEngine = nil
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let wasStarted = self.startedEmitted
        self.startedEmitted = false
        self.continuousMode = false
        if emitStopped && wasStarted {
            self.notifyListeners("listeningState", data: ["status": "stopped"])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stoppedByUser = true
            self.teardown(emitStopped: true)
            call.resolve()
        }
    }

    @objc func isListening(_ call: CAPPluginCall) {
        call.resolve(["listening": self.audioEngine?.isRunning ?? false])
    }

    @objc func getSupportedLanguages(_ call: CAPPluginCall) {
        let supportedLanguages = SFSpeechRecognizer.supportedLocales()
        let languagesArr = NSMutableArray()
        for lang in supportedLanguages {
            languagesArr.add(lang.identifier)
        }
        call.resolve(["languages": languagesArr])
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        let status = SFSpeechRecognizer.authorizationStatus()
        let permission: String
        switch status {
        case .authorized:
            permission = "granted"
        case .denied, .restricted:
            permission = "denied"
        case .notDetermined:
            permission = "prompt"
        @unknown default:
            permission = "prompt"
        }
        call.resolve(["speechRecognition": permission])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { (status) in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    AVAudioApplication.requestRecordPermission { (granted) in
                        call.resolve(["speechRecognition": granted ? "granted" : "denied"])
                    }
                case .denied, .restricted, .notDetermined:
                    self.checkPermissions(call)
                @unknown default:
                    self.checkPermissions(call)
                }
            }
        }
    }
}
