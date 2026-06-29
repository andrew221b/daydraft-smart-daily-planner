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
const INACTIVITY_MS = 15_000;

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
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Reset the silence watchdog — called on every transcript update and when
  // listening starts. Uses refs only so it's stable and safe to call from a
  // long-lived native event listener.
  const bumpActivity = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => stopRef.current(), INACTIVITY_MS);
  }, []);

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
      if (text) { onTextRef.current(text); bumpActivity(); }
    });
    const stateSub = SpeechRecognition.addListener("listeningState", (data) => {
      setStatus((prev) => (prev === "denied" ? prev : data.status === "started" ? "listening" : "idle"));
    });
    return () => {
      void partialSub.then((h) => h.remove());
      void stateSub.then((h) => h.remove());
    };
  }, [isNative, bumpActivity]);

  const stop = useCallback(() => {
    if (inactivityRef.current) { clearTimeout(inactivityRef.current); inactivityRef.current = null; }
    if (isNative) {
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
        // `continuous` is this app's patch (Android-only): keep the recogniser
        // alive across pauses instead of stopping on the first one, so one tap
        // dictates a whole list. iOS is already continuous and ignores it.
        await SpeechRecognition.start({
          language,
          partialResults: true,
          popup: false,
          maxResults: 1,
          continuous: true,
          ...(contextualStrings?.length ? { contextualStrings } : {}),
        } as Parameters<typeof SpeechRecognition.start>[0]);
      } catch (e) {
        console.warn("[voice] start failed", e);
        setStatus("idle");
        const msg = String((e as { message?: string })?.message ?? "").toLowerCase();
        onErrorRef.current?.(
          msg.includes("permission") || msg.includes("denied")
            ? "Microphone access denied — enable it in Settings."
            : msg.includes("in use")
              ? "Mic is busy — close other audio apps and try again."
              : "Couldn't start dictation. Try again.",
        );
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
      onTextRef.current(text);
      bumpActivity();
    };
    rec.onerror = (e) => {
      const code = e?.error ?? "";
      setStatus(code === "not-allowed" || code === "service-not-allowed" ? "denied" : "idle");
      if (code && code !== "aborted") onErrorRef.current?.(WEB_ERROR_COPY[code] ?? "Dictation stopped. Try again.");
    };
    rec.onend = () => setStatus("idle");
    webRecognitionRef.current = rec;
    setStatus("listening");
    rec.start();
    bumpActivity();
  }, [isNative, bumpActivity]);

  return { status, languages, start, stop };
}
