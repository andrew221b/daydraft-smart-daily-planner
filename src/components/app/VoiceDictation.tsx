/**
 * Mic button + language picker, shared by the timeline composer's
 * BulkInputStep and the checklist's brain-dump sheet. Renders nothing when
 * dictation isn't supported (desktop/iOS Safari web) — the textarea just
 * works as a plain textarea there, no broken affordance shown.
 *
 * The language list comes from the hook, already filtered to what the DEVICE
 * actually supports — so an English-only phone shows only English, never a
 * language whose model isn't installed (which would fail mute).
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Check, Languages } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { useVoiceInput, getVoiceLanguage, setVoiceLanguage, type VoiceLanguage } from "@/hooks/useVoiceInput";

function VoiceLanguageSheet({
  open,
  onOpenChange,
  value,
  languages,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: string;
  languages: VoiceLanguage[];
  onChange: (code: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/75 bg-popover max-h-[70vh] flex flex-col">
        <SheetHeader className="text-left shrink-0">
          <SheetTitle className="flex items-center gap-2 text-[16px]">
            <Languages className="h-4 w-4 text-primary" /> Dictation language
          </SheetTitle>
        </SheetHeader>
        <div className="mt-2 flex-1 overflow-y-auto pb-2 -mx-1 px-1">
          {languages.map((l) => {
            const active = l.code === value;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  haptics.selection();
                  onChange(l.code);
                  onOpenChange(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-xl text-[14.5px] font-medium pressable transition-colors ${
                  active ? "bg-primary/10 text-primary" : "text-foreground/90 hover:bg-foreground/[0.05]"
                }`}
              >
                <span>{l.label}</span>
                {active && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function VoiceMicButton({
  onText,
  onSessionStart,
  contextualStrings,
  className,
}: {
  /** Full cumulative transcript for the current dictation session. */
  onText: (text: string) => void;
  /** Fires the instant the mic is tapped to start a NEW session — use it to
   *  snapshot the textarea's pre-dictation value, since `onText` always
   *  reports the whole session's transcript (not a delta to append). */
  onSessionStart?: () => void;
  /** The user's own vocabulary (template names, list names, …) to bias
   *  recognition toward — iOS only, ignored elsewhere. See useVoiceInput. */
  contextualStrings?: string[];
  className?: string;
}) {
  const [lang, setLang] = useState(() => getVoiceLanguage());
  const [pickerOpen, setPickerOpen] = useState(false);
  const { status, languages, start, stop } = useVoiceInput(onText, (m) => toast.error(m));

  // The device list loads async (native getSupportedLanguages). If the saved
  // language isn't actually available on this device, fall back to the first
  // one that is — otherwise the mic would start with a model that can't run.
  useEffect(() => {
    if (languages.length && !languages.some((l) => l.code === lang)) {
      setLang(languages[0].code);
    }
  }, [languages, lang]);

  if (status === "unsupported") return null;

  const listening = status === "listening";

  const handleMicTap = () => {
    if (status === "denied") {
      toast.error("Microphone access denied — enable it in your device Settings.");
      return;
    }
    haptics.tap();
    if (listening) {
      stop();
    } else {
      onSessionStart?.();
      void start(lang, contextualStrings);
    }
  };

  return (
    <>
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        {/* Unmistakable "we're recording you" label — paired with the red,
            pulsing mic button so it reads at a glance, not just a subtle tint. */}
        <AnimatePresence>
          {listening && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1.5 h-7 px-2 rounded-full bg-destructive/12 text-[11px] font-semibold text-destructive whitespace-nowrap"
            >
              <motion.span
                className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0"
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
              />
              Listening…
            </motion.span>
          )}
        </AnimatePresence>
        <button
          type="button"
          onClick={handleMicTap}
          aria-label={listening ? "Stop dictation" : "Start dictation"}
          aria-pressed={listening}
          className={`relative h-8 w-8 flex items-center justify-center rounded-full pressable transition-colors ${
            listening ? "bg-destructive/15 text-destructive" : "bg-foreground/[0.06] text-secondary-fg/70 hover:text-foreground"
          }`}
        >
          {/* Always mounted — we toggle the animation via `listening` rather than
              mount/unmount through AnimatePresence. An infinite-repeat ring that
              gets unmounted mid-cycle (e.g. a session that dies right after start)
              orphans a half-finished loop that keeps pulsing forever; gating the
              `animate` prop instead lets framer-motion settle it cleanly to hidden. */}
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-destructive/20 pointer-events-none"
            initial={false}
            animate={
              listening
                ? { scale: [0.9, 1, 1.5], opacity: [0, 0.5, 0] }
                : { scale: 1, opacity: 0 }
            }
            transition={
              // The flicker was a two-keyframe [0.55, 0] pulse: at every loop it
              // snapped straight back to opacity 0.55 at small scale — a solid
              // ring popping into existence each cycle. A three-keyframe pulse
              // that BOTH starts and ends on opacity 0 makes the loop-back
              // (0 → 0) seamless; `times` fades it in fast (first 16%) then lets
              // it expand and fade out over the rest — a clean sonar ripple.
              listening
                ? { duration: 1.8, repeat: Infinity, ease: "easeOut", times: [0, 0.16, 1] }
                : { duration: 0.2 }
            }
          />
          <motion.span
            animate={listening ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={listening ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : undefined}
            className="relative z-10 flex items-center justify-center"
          >
            {listening ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Mic className="h-4 w-4" />}
          </motion.span>
        </button>
        {/* Only offer the language switch when there's an actual choice — a
            single-language device gets no pointless one-item picker. */}
        {languages.length > 1 && (
          <button
            type="button"
            onClick={() => { haptics.tap(); setPickerOpen(true); }}
            aria-label="Change dictation language"
            className="h-8 px-2 rounded-full text-[10.5px] font-bold uppercase tracking-wide text-secondary-fg/55 hover:text-foreground pressable transition-colors"
          >
            {lang.split("-")[0]}
          </button>
        )}
      </div>

      <VoiceLanguageSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={lang}
        languages={languages}
        onChange={(code) => {
          setLang(code);
          setVoiceLanguage(code);
        }}
      />
    </>
  );
}
