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

// Minimal shape of the browser's (non-standard, vendor-prefixed) SpeechRecognition API.
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type WebSpeechWindow = Window & {
  SpeechRecognition?: new () => WebSpeechRecognition;
  webkitSpeechRecognition?: new () => WebSpeechRecognition;
};

/**
 * One dictation session = one mic tap until tap-again or the OS detects
 * silence. `onText` fires with the FULL cumulative transcript for the
 * CURRENT session on every update (native engines report the whole
 * hypothesis-so-far, not a delta) — callers replace their live preview with
 * it rather than appending.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const webRecognitionRef = useRef<WebSpeechRecognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const isNative = Capacitor.isNativePlatform();
  const webCtorAvailable = useCallback(
    () => typeof window !== "undefined" &&
      !!((window as WebSpeechWindow).SpeechRecognition || (window as WebSpeechWindow).webkitSpeechRecognition),
    [],
  );

  // Resolve initial support.
  useEffect(() => {
    if (!isNative) {
      setStatus(webCtorAvailable() ? "idle" : "unsupported");
      return;
    }
    let alive = true;
    void SpeechRecognition.available()
      .then(({ available }) => { if (alive) setStatus(available ? "idle" : "unsupported"); })
      .catch(() => { if (alive) setStatus("unsupported"); });
    return () => { alive = false; };
  }, [isNative, webCtorAvailable]);

  // Native event wiring — partial results feed the live transcript, and the
  // listeningState event (not start()'s own promise) is the source of truth
  // for whether the mic is actually still on.
  useEffect(() => {
    if (!isNative) return;
    const partialSub = SpeechRecognition.addListener("partialResults", (data) => {
      const text = data.matches?.[0];
      if (text) onTextRef.current(text);
    });
    const stateSub = SpeechRecognition.addListener("listeningState", (data) => {
      setStatus((prev) => (prev === "denied" ? prev : data.status === "started" ? "listening" : "idle"));
    });
    return () => {
      void partialSub.then((h) => h.remove());
      void stateSub.then((h) => h.remove());
    };
  }, [isNative]);

  const stop = useCallback(() => {
    if (isNative) {
      void SpeechRecognition.stop().catch(() => { /* already stopped */ });
    } else {
      webRecognitionRef.current?.stop();
      setStatus("idle");
    }
  }, [isNative]);

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
            return;
          }
        }
        // popup:false is required on Android for partialResults to actually
        // fire (per the plugin's own docs); maxResults:1 — we only show the
        // top hypothesis live, matching the textarea's single-string value.
        await SpeechRecognition.start({
          language,
          partialResults: true,
          popup: false,
          maxResults: 1,
          ...(contextualStrings?.length ? { contextualStrings } : {}),
        } as Parameters<typeof SpeechRecognition.start>[0]);
      } catch (e) {
        console.warn("[voice] start failed", e);
        setStatus("idle");
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
    };
    rec.onerror = () => setStatus("idle");
    rec.onend = () => setStatus("idle");
    webRecognitionRef.current = rec;
    setStatus("listening");
    rec.start();
  }, [isNative]);

  return { status, start, stop };
}
