/**
 * Voice dictation for the task composers (timeline + checklist brain-dump).
 *
 * Native (iOS/Android): @capacitor-community/speech-recognition wraps the
 * OS's own on-device speech engine (SFSpeechRecognizer / SpeechRecognizer) —
 * no audio leaves the device, no extra AI cost, no added latency before the
 * existing parse-tasks step. Text is plugged into the SAME textarea the
 * composers already use; nothing about the AI parsing pipeline changes.
 *
 * Web (PWA): falls back to the browser's native Web Speech API. Only
 * Chromium-based browsers implement it — iOS/desktop Safari do not — so the
 * caller MUST check `status !== "unsupported"` and hide the mic entirely
 * rather than show a button that will only error.
 *
 * IMPORTANT — why `start()` doesn't `await` its own listening result:
 * the plugin's own docs say that with `partialResults: true`, `start()`
 * "responds directly without result" (resolves almost immediately, before
 * speech ends) — the ACTUAL listening lifecycle comes from the separate
 * `listeningState` event ('started'/'stopped'). Treating start()'s resolution
 * as "done listening" would flip the UI back to idle while the mic is still
 * actively recording in the background.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

export interface VoiceLanguage {
  code: string; // BCP-47 tag passed straight to the recognizer
  label: string;
}

// Curated, not exhaustive — a quick-pick list beats a 150-locale dropdown.
// Covers the app's actual userbase langs (en/ru first) plus the next tier of
// globally common languages so dictation never silently locks to whatever
// the OS locale happens to be.
export const VOICE_LANGUAGES: readonly VoiceLanguage[] = [
  { code: "en-US", label: "English" },
  { code: "ru-RU", label: "Русский" },
  { code: "de-DE", label: "Deutsch" },
  { code: "fr-FR", label: "Français" },
  { code: "es-ES", label: "Español" },
  { code: "pt-BR", label: "Português" },
  { code: "it-IT", label: "Italiano" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "uk-UA", label: "Українська" },
  { code: "pl-PL", label: "Polski" },
  { code: "tr-TR", label: "Türkçe" },
  { code: "ar-SA", label: "العربية" },
] as const;

const VOICE_LANG_KEY = "dd_voice_lang";

function inferDefaultLanguage(): string {
  try {
    const sys = (navigator.language || "en-US").toLowerCase();
    const exact = VOICE_LANGUAGES.find((l) => l.code.toLowerCase() === sys);
    if (exact) return exact.code;
    const base = sys.split("-")[0];
    const byBase = VOICE_LANGUAGES.find((l) => l.code.toLowerCase().startsWith(base));
    return byBase?.code ?? "en-US";
  } catch {
    return "en-US";
  }
}

/** The user's last-picked dictation language, defaulting to the device locale (once). */
export function getVoiceLanguage(): string {
  try {
    return localStorage.getItem(VOICE_LANG_KEY) || inferDefaultLanguage();
  } catch {
    return "en-US";
  }
}

export function setVoiceLanguage(code: string): void {
  try {
    localStorage.setItem(VOICE_LANG_KEY, code);
  } catch {
    /* ignore */
  }
}

export type VoiceStatus = "idle" | "listening" | "unsupported" | "denied";

// Auto-stop after this much SILENCE (no new transcript) on any platform. We run
// the mic continuously (press → talk with pauses → press stop), so a fixed
// total cap would cut off a long dictation; instead we bound the hot-mic window
// to ~this long after the user actually stops talking — protecting battery and
// privacy without interrupting active speech. Reset on every transcript update.
// 30s (was 15): users think mid-dump — a long "what else…" pause ending the
// session read as "recording just cuts off".
const INACTIVITY_MS = 30_000;

// How many times a native session that died on its own (engine teardown,
// spin-guard bail, unpatched plugin ending after one utterance) is silently
// revived WITHOUT new speech in between before we give up and go idle. Any
// new transcript resets the streak, so an hour-long dictation can survive any
// number of engine deaths as long as the user is actually talking.
const MAX_RESUMES_WITHOUT_TEXT = 2;

// Shorter watchdog for the case where the mic is "listening" but NOTHING has been
// transcribed yet — a session that started but is silently broken (engine never
// fed audio, model not ready, Android stuck in a restart spin). Rather than leave
// the user staring at a pulsing mic that never captures anything, we bail after
// this long with no first result and tell them to try again.
const FIRST_RESULT_MS = 10_000;

// Minimal shape of the browser's (non-standard, vendor-prefixed) SpeechRecognition API.
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type WebSpeechWindow = Window & {
  SpeechRecognition?: new () => WebSpeechRecognition;
  webkitSpeechRecognition?: new () => WebSpeechRecognition;
};

/**
 * Intersect the curated quick-pick list with what the device can ACTUALLY
 * recognise, so a user only ever sees languages their phone has installed
 * (English-only phone → only English in the picker). Matched by base language
 * so a device locale like "en_GB" still enables our "English" (en-US) entry.
 */
function filterToSupported(deviceLocales: unknown[]): VoiceLanguage[] {
  const bases = new Set(
    deviceLocales
      .map((l) => String(l).replace(/_/g, "-").toLowerCase().split("-")[0])
      .filter(Boolean),
  );
  const filtered = VOICE_LANGUAGES.filter((l) => bases.has(l.code.split("-")[0]));
  // Never hand back an empty picker — if the device reported nothing usable,
  // keep the full curated list rather than hiding dictation entirely.
  return filtered.length ? filtered : [...VOICE_LANGUAGES];
}

// Segments are newline-joined everywhere (native accumulators do the same) —
// each is a post-pause utterance, and a line break is the natural boundary for
// the downstream task-splitter.
const joinSegs = (a: string, b: string) => (a && b ? `${a}\n${b}` : a || b);

// Web Speech API error codes → human copy. Anything not listed gets a generic line.
const WEB_ERROR_COPY: Record<string, string> = {
  "no-speech": "Didn't catch anything — try again.",
  "audio-capture": "No microphone found.",
  "not-allowed": "Microphone access denied — enable it in Settings.",
  "service-not-allowed": "Microphone access denied — enable it in Settings.",
  "language-not-supported": "This language isn't available for dictation here.",
  network: "Voice needs a connection for this language.",
};

/**
 * One dictation session = one mic tap until tap-again or the engine detects
 * silence. `onText` fires with the FULL cumulative transcript for the CURRENT
 * session on every update (native engines report the whole hypothesis-so-far,
 * not a delta) — callers replace their live preview with it rather than
 * appending. `onError` surfaces a human-readable problem (denied permission,
 * unsupported language, mic busy, …) so the caller can toast it instead of
 * failing silently.
 */
export function useVoiceInput(
  onText: (text: string) => void,
  onError?: (message: string) => void,
) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [languages, setLanguages] = useState<VoiceLanguage[]>(() => [...VOICE_LANGUAGES]);
  const webRecognitionRef = useRef<WebSpeechRecognition | null>(null);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef<() => void>(() => {});
  // After a user-initiated stop, ignore any late "started" event until this
  // timestamp. A continuous-mode restart can emit a stray "started" right after
  // the user hit stop (engine still tearing down) — without this guard that
  // flips the mic UI back on, so the indicator lingers / "won't turn off". See stop().
  const suppressStartedUntilRef = useRef(0);
  // Did the CURRENT session ever produce a (non-empty) transcript? Drives the
  // watchdog window (short until the first result, long after) and whether a
  // timeout is a silent failure worth surfacing vs. a normal end-of-speech stop.
  const gotTranscriptRef = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  /* ── Session-transcript integrity (JS-side accumulation) ─────────────────
   * The native layers accumulate the session transcript themselves, but every
   * "my earlier words got erased" bug so far traced to that accumulation being
   * lost at an utterance / sub-session boundary (errorful utterance end, engine
   * teardown, spin-guard bail, a binary built before the continuous patch). So
   * the hook keeps its OWN committed buffer and never trusts the native layer
   * with text the user has already seen: a native emission that no longer
   * extends what the engine had previously committed is treated as a native
   * reset — the previous emission is folded into `committedRef` and the new
   * one appended after it. Erasure becomes structurally impossible; the worst
   * a native bug can now cause is a duplicated line, which the downstream AI
   * parse dedupes anyway.
   * ──────────────────────────────────────────────────────────────────────── */
  const committedRef = useRef("");   // session text under JS control — survives native resets
  const nativeLastRef = useRef(""); // previous RAW native emission (current native sub-session)
  const lastEmitAtRef = useRef(0);  // timestamp of the last emission (revision-vs-reset heuristic)
  const userStoppedRef = useRef(false); // explicit stop (tap / watchdog / unmount) — blocks auto-resume
  const resumesWithoutTextRef = useRef(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNativeOptsRef = useRef<Parameters<typeof SpeechRecognition.start>[0] | null>(null);
  // Fold whatever the current native sub-session produced into the JS-owned
  // buffer. Called whenever that sub-session is over (auto-resume boundary) or
  // discovered to have lost its own accumulation mid-flight.
  const foldNative = useCallback(() => {
    committedRef.current = joinSegs(committedRef.current, nativeLastRef.current);
    nativeLastRef.current = "";
  }, []);

  // Reset the silence watchdog — called on every transcript update and when
  // listening starts. Uses refs only so it's stable and safe to call from a
  // long-lived native event listener. Before any transcript arrives we use the
  // shorter FIRST_RESULT_MS so a silently-broken session is caught quickly; once
  // speech is flowing we allow the longer INACTIVITY_MS between phrases.
  const bumpActivity = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    const ms = gotTranscriptRef.current ? INACTIVITY_MS : FIRST_RESULT_MS;
    inactivityRef.current = setTimeout(() => {
      const gotAny = gotTranscriptRef.current;
      stopRef.current();
      // Only nag when the mic produced nothing at all — a timeout after real
      // speech is just the natural end of dictation and needs no error toast.
      if (!gotAny) onErrorRef.current?.("Didn't catch anything — check your mic and try again.");
    }, ms);
  }, []);

  // Every transcript update (native partialResults / web onresult) funnels
  // through here. `raw` is the engine's own cumulative text for its CURRENT
  // sub-session; what the caller sees is committed + raw.
  const emitTranscript = useCallback((raw: string) => {
    if (!raw) return;
    const prev = nativeLastRef.current;
    if (prev) {
      // The engine's already-committed part is everything before its last
      // newline (segments are newline-joined on both native sides). A new
      // emission that doesn't start with that prefix means the native
      // accumulator lost state — rescue the previous emission first.
      const nl = prev.lastIndexOf("\n");
      const stable = nl >= 0 ? prev.slice(0, nl + 1) : "";
      if (stable) {
        if (!raw.startsWith(stable)) foldNative();
      } else {
        // Single-segment case has no committed prefix to test, so split
        // "live revision of the same utterance" from "fresh text after the
        // old was lost" heuristically: revisions stream in sub-second cadence
        // and share a leading run of characters; post-pause fresh text does
        // neither. Err on the side of folding — a rare duplicate beats lost
        // speech (the AI parse dedupes anyway). Mirrors the Android plugin's
        // segment-reset guard so unpatched binaries and web get it too.
        const gap = Date.now() - lastEmitAtRef.current;
        const a = raw.toLowerCase(), b = prev.toLowerCase();
        let shared = 0;
        while (shared < Math.min(a.length, b.length) && a[shared] === b[shared]) shared++;
        if (prev.length >= 6 && shared < 3 && gap > 1200) foldNative();
      }
    }
    nativeLastRef.current = raw;
    lastEmitAtRef.current = Date.now();
    gotTranscriptRef.current = true;
    resumesWithoutTextRef.current = 0;
    onTextRef.current(joinSegs(committedRef.current, raw));
    bumpActivity();
  }, [bumpActivity, foldNative]);

  // A native session ended on its own (NOT via stop()). Decide whether to
  // silently revive it — preserving the transcript across the gap — or let the
  // session end for real. Returns true when a resume was scheduled.
  const tryAutoResume = useCallback((restart: () => Promise<void> | void): boolean => {
    if (userStoppedRef.current) return false;
    if (!gotTranscriptRef.current) return false; // nothing heard yet — let the watchdog decide
    if (resumesWithoutTextRef.current >= MAX_RESUMES_WITHOUT_TEXT) return false;
    resumesWithoutTextRef.current += 1;
    foldNative();
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      if (userStoppedRef.current) return;
      void (async () => {
        try {
          await restart();
        } catch {
          // One re-attempt after a full teardown (mirrors start()'s busy retry).
          try { await SpeechRecognition.stop(); } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 350));
          if (userStoppedRef.current) return;
          try { await restart(); } catch { setStatus("idle"); }
        }
      })();
    }, 300);
    return true;
  }, [foldNative]);

  const isNative = Capacitor.isNativePlatform();
  const webCtorAvailable = useCallback(
    () => typeof window !== "undefined" &&
      !!((window as WebSpeechWindow).SpeechRecognition || (window as WebSpeechWindow).webkitSpeechRecognition),
    [],
  );

  // Resolve initial support + the device's real language list.
  useEffect(() => {
    if (!isNative) {
      setStatus(webCtorAvailable() ? "idle" : "unsupported");
      return; // web can't enumerate languages — keep the full curated list
    }
    let alive = true;
    void SpeechRecognition.available()
      .then(({ available }) => { if (alive) setStatus(available ? "idle" : "unsupported"); })
      .catch(() => { if (alive) setStatus("unsupported"); });
    // getSupportedLanguages is unavailable on Android 13+ (it rejects there) —
    // we just keep the full curated list in that case, the safe default.
    void SpeechRecognition.getSupportedLanguages()
      .then(({ languages: locales }) => {
        if (alive && Array.isArray(locales) && locales.length) setLanguages(filterToSupported(locales));
      })
      .catch(() => { /* keep full list */ });
    return () => { alive = false; };
  }, [isNative, webCtorAvailable]);

  // Native event wiring — partial results feed the live transcript, and the
  // listeningState event (not start()'s own promise) is the source of truth
  // for whether the mic is actually still on.
  useEffect(() => {
    if (!isNative) return;
    const partialSub = SpeechRecognition.addListener("partialResults", (data) => {
      const text = data.matches?.[0];
      if (text) emitTranscript(text);
    });
    const stateSub = SpeechRecognition.addListener("listeningState", (data) => {
      if (data.status === "started") {
        setStatus((prev) => {
          if (prev === "denied") return prev;
          // Drop a stray "started" that lands just after the user stopped.
          if (Date.now() < suppressStartedUntilRef.current) return prev;
          return "listening";
        });
        return;
      }
      // Native session ended. If the USER didn't end it (engine died mid-dump,
      // spin-guard bailed, single-utterance plugin finished), revive it
      // seamlessly: transcript is folded so nothing is lost, the UI never
      // leaves "listening", and dictation just keeps going.
      if (
        tryAutoResume(async () => {
          if (lastNativeOptsRef.current) await SpeechRecognition.start(lastNativeOptsRef.current);
        })
      ) {
        return;
      }
      setStatus((prev) => (prev === "denied" ? prev : "idle"));
    });
    return () => {
      void partialSub.then((h) => h.remove());
      void stateSub.then((h) => h.remove());
    };
  }, [isNative, emitTranscript, tryAutoResume]);

  const stop = useCallback(() => {
    // Explicit end of session — an auto-resume must never revive it.
    userStoppedRef.current = true;
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    if (inactivityRef.current) { clearTimeout(inactivityRef.current); inactivityRef.current = null; }
    if (isNative) {
      // Stop is authoritative. Flip the UI to idle IMMEDIATELY (don't wait for the
      // native "stopped" event, which can lag or be preceded by a stray restart
      // "started"), and suppress any "started" for a moment so the indicator
      // never lingers or re-arms while the engine finishes tearing down.
      suppressStartedUntilRef.current = Date.now() + 1500;
      setStatus("idle");
      void SpeechRecognition.stop().catch(() => { /* already stopped */ });
    } else {
      webRecognitionRef.current?.stop();
      setStatus("idle");
    }
  }, [isNative]);
  stopRef.current = stop;

  // Arm the silence watchdog while listening; clear it the moment we're idle.
  useEffect(() => {
    if (status === "listening") {
      bumpActivity();
    } else if (inactivityRef.current) {
      clearTimeout(inactivityRef.current);
      inactivityRef.current = null;
    }
  }, [status, bumpActivity]);

  // Never leave the mic hot after this component goes away (e.g. the composer
  // sheet is closed mid-dictation). Best-effort stop on unmount.
  useEffect(() => {
    return () => {
      userStoppedRef.current = true; // block any in-flight auto-resume
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      webRecognitionRef.current?.stop();
      if (Capacitor.isNativePlatform()) void SpeechRecognition.stop().catch(() => { /* already stopped */ });
    };
  }, []);

  /**
   * `contextualStrings` only does anything on iOS (our hand-vendored plugin
   * reads it and sets SFSpeechRecognitionRequest.contextualStrings — see
   * SpeechRecognitionPlugin.swift). Android's intent-based recognizer has no
   * equivalent hook and the upstream TS types don't declare this field since
   * it's this app's own addition, hence the cast.
   */
  const start = useCallback(async (language: string, contextualStrings?: string[]) => {
    // Fresh session: no transcript yet, so the watchdog runs on the short window.
    gotTranscriptRef.current = false;
    userStoppedRef.current = false;
    committedRef.current = "";
    nativeLastRef.current = "";
    lastEmitAtRef.current = 0;
    resumesWithoutTextRef.current = 0;
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    if (isNative) {
      try {
        const perm = await SpeechRecognition.checkPermissions();
        if (perm.speechRecognition !== "granted") {
          const req = await SpeechRecognition.requestPermissions();
          if (req.speechRecognition !== "granted") {
            setStatus("denied");
            onErrorRef.current?.("Microphone access denied — enable it in Settings.");
            return;
          }
        }
        // popup:false is required on Android for partialResults to actually
        // fire (per the plugin's own docs); maxResults:1 — we only show the
        // top hypothesis live, matching the textarea's single-string value.
        // `continuous` keeps the recogniser alive across pauses (one tap dictates
        // a whole list) — Android via this app's patch, iOS via the vendored plugin.
        const opts = {
          language,
          partialResults: true,
          popup: false,
          maxResults: 1,
          continuous: true,
          ...(contextualStrings?.length ? { contextualStrings } : {}),
        } as Parameters<typeof SpeechRecognition.start>[0];
        lastNativeOptsRef.current = opts; // auto-resume restarts with the same options

        const attempt = async (): Promise<unknown> => {
          try { await SpeechRecognition.start(opts); return null; }
          catch (e) { return e || new Error("start failed"); }
        };

        // Re-allow "started" events (a prior stop may have armed the suppressor)
        // and show "listening" optimistically so the FIRST tap feels responsive —
        // the native "started" event normally confirms within a moment, and a real
        // failure below reverts it.
        suppressStartedUntilRef.current = 0;
        setStatus("listening");
        let err = await attempt();
        if (err) {
          // A stale session can leave the engine "busy"/"ongoing" — fully tear it
          // down and try ONCE more before surfacing an error. This is the single
          // biggest cause of the intermittent "Couldn't start dictation".
          try { await SpeechRecognition.stop(); } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 350));
          suppressStartedUntilRef.current = 0;
          setStatus("listening");
          err = await attempt();
        }
        if (err) {
          console.warn("[voice] start failed", err);
          setStatus("idle");
          const msg = String((err as { message?: string })?.message ?? "").toLowerCase();
          onErrorRef.current?.(
            msg.includes("permission") || msg.includes("denied")
              ? "Microphone access denied — enable it in Settings."
              : msg.includes("use") || msg.includes("ongoing") || msg.includes("busy")
                ? "Mic is busy — close other audio apps and try again."
                : "Couldn't start dictation. Try again.",
          );
        }
      } catch (e) {
        console.warn("[voice] start failed (outer)", e);
        setStatus("idle");
        onErrorRef.current?.("Couldn't start dictation. Try again.");
      }
      return;
    }

    const Ctor = (window as WebSpeechWindow).SpeechRecognition || (window as WebSpeechWindow).webkitSpeechRecognition;
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      emitTranscript(text);
    };
    rec.onerror = (e) => {
      const code = e?.error ?? "";
      if (code === "not-allowed" || code === "service-not-allowed") {
        setStatus("denied");
        onErrorRef.current?.(WEB_ERROR_COPY[code]);
        return;
      }
      // Benign mid-dictation errors (silence, blip): onend fires right after
      // and auto-resumes there — don't flash idle or toast in between.
      if (userStoppedRef.current || !gotTranscriptRef.current) {
        setStatus("idle");
        if (code && code !== "aborted") onErrorRef.current?.(WEB_ERROR_COPY[code] ?? "Dictation stopped. Try again.");
      }
    };
    rec.onend = () => {
      // Chrome ends a recognition run after any longer silence even with
      // continuous:true — same seamless-revive as native, same fold-first
      // guarantee that no already-spoken text is lost.
      if (tryAutoResume(() => { webRecognitionRef.current?.start(); })) return;
      setStatus("idle");
    };
    webRecognitionRef.current = rec;
    setStatus("listening");
    rec.start();
    bumpActivity();
  }, [isNative, bumpActivity, emitTranscript, tryAutoResume]);

  return { status, languages, start, stop };
}
