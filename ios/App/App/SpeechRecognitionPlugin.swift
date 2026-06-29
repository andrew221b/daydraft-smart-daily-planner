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

    @objc func available(_ call: CAPPluginCall) {
        guard let recognizer = SFSpeechRecognizer() else {
            call.resolve(["available": false])
            return
        }
        call.resolve(["available": recognizer.isAvailable])
    }

    @objc func start(_ call: CAPPluginCall) {
        if let engine = self.audioEngine, engine.isRunning {
            call.reject(self.messageOngoing)
            return
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

            let language: String = call.getString("language") ?? "en-US"
            let maxResults: Int = call.getInt("maxResults") ?? self.defaultMatches
            let partialResults: Bool = call.getBool("partialResults") ?? false

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
                call.reject("Microphone is already in use by another application.")
                return
            }

            self.recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
            self.recognitionRequest?.shouldReportPartialResults = partialResults
            // .dictation (vs the default .unspecified/.search/.confirmation) tells
            // Apple's model this is free-form speech, not a short command or
            // search query — measurably better accuracy for multi-sentence dumps.
            self.recognitionRequest?.taskHint = .dictation
            // Auto-inserts commas/periods (iOS 16+; this app's min target is 17.6).
            // Helps the user read back what they said, and gives the downstream
            // AI task-splitter cleaner sentence boundaries in a multi-task dump.
            if #available(iOS 16.0, *) {
                self.recognitionRequest?.addsPunctuation = true
            }
            // Biases recognition toward the user's OWN vocabulary — their saved
            // task templates / checklist category names. Apple's model uses this
            // as a soft hint (boosts likelihood, doesn't force a match), so it
            // helps recognize names/specific words without blocking anything
            // else the user says. Not in the upstream plugin's options — this
            // app's own addition, JS passes it only on iOS (Android's intent-
            // based recognizer has no equivalent hook).
            if let hints = call.getArray("contextualStrings", String.self), !hints.isEmpty {
                self.recognitionRequest?.contextualStrings = hints
            }

            guard let engine = self.audioEngine else {
                call.reject(self.messageUnknown)
                return
            }
            let inputNode = engine.inputNode
            let format = inputNode.outputFormat(forBus: 0)

            self.recognitionTask = self.speechRecognizer?.recognitionTask(with: self.recognitionRequest!) { (result, error) in
                if let result = result {
                    let resultArray = NSMutableArray()
                    var counter = 0
                    for transcription in result.transcriptions {
                        if maxResults > 0 && counter < maxResults {
                            resultArray.add(transcription.formattedString)
                        }
                        counter += 1
                    }

                    if partialResults {
                        self.notifyListeners("partialResults", data: ["matches": resultArray])
                    } else {
                        call.resolve(["matches": resultArray])
                    }

                    if result.isFinal {
                        self.audioEngine?.stop()
                        self.audioEngine?.inputNode.removeTap(onBus: 0)
                        self.notifyListeners("listeningState", data: ["status": "stopped"])
                        self.recognitionTask = nil
                        self.recognitionRequest = nil
                    }
                }

                if let error = error {
                    self.audioEngine?.stop()
                    self.audioEngine?.inputNode.removeTap(onBus: 0)
                    self.recognitionRequest = nil
                    self.recognitionTask = nil
                    self.notifyListeners("listeningState", data: ["status": "stopped"])
                    call.reject(error.localizedDescription)
                }
            }

            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { (buffer, _) in
                self.recognitionRequest?.append(buffer)
            }

            engine.prepare()
            do {
                try engine.start()
                self.notifyListeners("listeningState", data: ["status": "started"])
                if partialResults {
                    call.resolve()
                }
            } catch {
                call.reject(self.messageUnknown)
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .default).async {
            if let engine = self.audioEngine, engine.isRunning {
                engine.stop()
                self.recognitionRequest?.endAudio()
                self.notifyListeners("listeningState", data: ["status": "stopped"])
            }
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
