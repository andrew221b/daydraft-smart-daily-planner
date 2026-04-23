import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Block } from "@/lib/daydraft";
import { Check, ChevronRight, Minus, Plus, Sparkles, MapPin, ExternalLink, Loader2, Lightbulb, Copy, Phone, CalendarPlus, Mail, Timer, Square } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { mapsUrl } from "@/lib/maps";
import { toast } from "sonner";
import { useTimeTracker, fmtHMS } from "@/hooks/useTimeTracker";
import { haptics } from "@/lib/haptics";
import { PreflightSheet } from "@/components/app/PreflightSheet";
import { QuickCaptureButton } from "@/components/app/QuickCapture";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AIHelp = {
  substeps: string[];
  links: { label: string; url: string }[];
  tip: string;
  draft?: { subject?: string; body: string };
};

export default function Focus() {
  const { blockId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { active: tracking, start: startTracking, stop: stopTracking, elapsedSec, categories } = useTimeTracker();
  const [block, setBlock] = useState<any | null>(null);
  const [next, setNext] = useState<Block | null>(null);
  const [remaining, setRemaining] = useState<number>(0); // seconds
  const [total, setTotal] = useState<number>(1);
  const [showCheck, setShowCheck] = useState(false);
  const [help, setHelp] = useState<AIHelp | null>(null);
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpError, setHelpError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const tickRef = useRef<number | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [extended, setExtended] = useState(false);
  const startedHereRef = useRef(false);
  const [confirmSkipOpen, setConfirmSkipOpen] = useState(false);

  useEffect(() => {
    if (!blockId || !user) return;
    // Reset all per-block state so navigating between blocks via /focus/:id
    // doesn't leave the previous block's UI (e.g. green checkmark) on screen.
    setBlock(null);
    setNext(null);
    setRemaining(0);
    setTotal(1);
    setShowCheck(false);
    setExtended(false);
    setExtendedMin(0);
    setArmed(false);
    setHelp(null);
    setHelpOpen(false);
    setHelpError(null);
    setHelpLoading(false);
    startedHereRef.current = false;
    (async () => {
      const { data } = await supabase.from("blocks").select("*").eq("id", blockId).maybeSingle();
      if (!data) {
        toast("This block no longer exists");
        nav("/today/plan");
        return;
      }
      setBlock(data as Block);
      setTotal(data.duration_min * 60);
      setRemaining(data.duration_min * 60);
      // Match DayView's "Start" button: skip calendar events the user can't act on
      // inside Focus mode. Otherwise the "Next" jump lands on a non-actionable item.
      const { data: rest } = await supabase.from("blocks").select("*").eq("plan_id", data.plan_id)
        .eq("kind", "task").eq("completed", false).eq("is_calendar_event", false)
        .gt("position", data.position).order("position").limit(1);
      setNext((rest?.[0] as Block) || null);
      // Show preflight on first visit per session — unless the user opted out.
      // Skip on intra-session block transitions to avoid nagging.
      const optedOut = (() => { try { return localStorage.getItem("dd_preflight_disabled") === "1"; } catch { return false; } })();
      if (!optedOut && !sessionStorage.getItem("dd_preflight_seen") && !sessionStorage.getItem("dd_focus_active")) {
        setPreflightOpen(true);
      } else {
        setArmed(true);
      }
      sessionStorage.setItem("dd_focus_active", "1");
    })();
  }, [blockId, user?.id]);

  const dismissPreflight = () => {
    sessionStorage.setItem("dd_preflight_seen", "1");
    setPreflightOpen(false);
    setArmed(true);
  };

  useEffect(() => {
    if (!block || !armed) return;
    const onVis = () => { /* timer pauses naturally when tab hidden — we use realtime */ };
    document.addEventListener("visibilitychange", onVis);
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      if (!document.hidden) {
        const dt = (now - last) / 1000;
        setRemaining(r => Math.max(0, r - dt));
      }
      last = now;
      tickRef.current = window.setTimeout(tick, 250);
    };
    tick();
    return () => { if (tickRef.current) clearTimeout(tickRef.current); document.removeEventListener("visibilitychange", onVis); };
  }, [block?.id, armed]);

  useEffect(() => {
    if (!block || !armed) return;
    if (remaining > 0) return;
    // Offer extend before auto-completing the block
    if (!extended) {
      // pause at zero — show "extend or complete" UI; do nothing here
      return;
    }
    complete();
    // eslint-disable-next-line
  }, [remaining]);

  const EXTEND_CAP_MIN = 60; // hard cap on cumulative extensions per block
  const [extendedMin, setExtendedMin] = useState(0);
  const extendFiveMin = () => {
    if (extendedMin + 5 > EXTEND_CAP_MIN) {
      toast("Already extended an hour. Wrap up or mark complete.", { duration: 3500 });
      return;
    }
    setRemaining(r => r + 5 * 60);
    setTotal(t => t + 5 * 60);
    setExtendedMin(m => m + 5);
    setExtended(true);
    haptics.tap();
    toast.success(`+5 min · ${extendedMin + 5}/${EXTEND_CAP_MIN}m extended`);
  };

  // Start time-tracking only if the user opted in for THIS task during planning.
  // The choice is persisted per plan in localStorage (see Today.tsx).
  useEffect(() => {
    if (!block || !categories.length) return;
    if (tracking) return; // honor any existing session
    let optedIn = false;
    try {
      const raw = localStorage.getItem(`dd_track_titles_${block.plan_id}`);
      const titles: string[] = raw ? JSON.parse(raw) : [];
      optedIn = titles.includes((block.title || "").trim().toLowerCase());
    } catch {/* ignore */}
    if (!optedIn) return;
    startedHereRef.current = true;
    startTracking(undefined, { source: "focus", blockId: block.id, note: block.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, categories.length]);

  useEffect(() => {
    return () => {
      // Stop tracking on unmount (leaving Focus entirely)
      if (startedHereRef.current && tracking) stopTracking();
      sessionStorage.removeItem("dd_focus_active");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trackingCat = categories.find(c => c.id === tracking?.category_id);

  const loadHelp = async () => {
    if (!block || helpLoading) return;
    setHelpOpen(true);
    if (help) return;
    setHelpLoading(true);
    setHelpError(null);
    try {
      const { data, error } = await supabase.functions.invoke("task-assistant", {
        body: {
          title: block.title,
          type: block.type,
          location: block.location,
          duration_min: block.duration_min,
        },
      });
      if (error) throw error;
      setHelp(data as AIHelp);
    } catch (e: any) {
      console.error(e);
      setHelpError(e?.message || "Couldn't load assistant");
    } finally {
      setHelpLoading(false);
    }
  };

  const complete = async () => {
    if (!block) return;
    haptics.notify("success");
    setShowCheck(true);
    // Persist completion BEFORE navigating so a flaky network can't leave the
    // block stuck as incomplete after we've already advanced the user.
    const { error } = await supabase.from("blocks").update({ completed: true }).eq("id", block.id);
    if (error) {
      setShowCheck(false);
      toast.error("Couldn't save — try again");
      return;
    }
    if (startedHereRef.current && tracking) {
      try { await stopTracking(); } catch {/* ignore */}
      startedHereRef.current = false;
    }
    setTimeout(() => {
      if (next) nav(`/focus/${next.id}`);
      else nav("/recap");
    }, 600);
  };

  const skip = async () => {
    if (!block) return;
    haptics.impact("light");
    await supabase.from("blocks").update({ completed: true }).eq("id", block.id);
    if (startedHereRef.current && tracking) {
      try { await stopTracking(); } catch {/* ignore */}
      startedHereRef.current = false;
    }
    if (next) nav(`/focus/${next.id}`); else nav("/recap");
  };

  if (!block) return <div className="min-h-screen bg-background" />;

  const pct = 1 - remaining / total;
  const radius = 110;
  const circ = 2 * Math.PI * radius;
  const offset = circ * pct;
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  const lowTime = remaining < 300;
  const timeUp = remaining <= 0 && armed;

  // Smart contextual quick actions derived from the title/type
  const title = (block.title || "").toLowerCase();
  const isCall = /\b(call|phone|ring|dial)\b/.test(title);
  const isMeeting = block.type === "communication" && /\b(meeting|sync|standup|1:1|catchup|catch-up|call with|meet with)\b/.test(title);
  const isEmail = /\b(email|reply|respond|inbox)\b/.test(title);

  const calendarUrl = (() => {
    const t = encodeURIComponent(block.title || "Block");
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${t}`;
  })();
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(block.title || "")}`;
  const telUrl = `tel:`;

  const copyDraft = async () => {
    if (!help?.draft) return;
    const txt = help.draft.subject
      ? `Subject: ${help.draft.subject}\n\n${help.draft.body}`
      : help.draft.body;
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Draft copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className="min-h-screen w-full bg-background flex justify-center">
      <div className="relative w-full max-w-[390px] min-h-screen flex flex-col items-center px-6 pt-14 pb-10 page-enter">
        <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/30 text-[11px] tracking-[0.2em] text-primary font-medium uppercase">Focus Mode</div>
        {tracking && trackingCat && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-border text-[11px] text-secondary-fg">
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: trackingCat.color }} />
            Tracking · <span className="text-foreground font-medium">{trackingCat.name}</span>
            <span className="font-mono tabular-nums">{fmtHMS(elapsedSec)}</span>
          </div>
        )}

        <h1 className="mt-12 text-[28px] font-semibold text-center leading-tight max-w-[300px] line-clamp-2">{block.title}</h1>

        <div className="relative mt-12">
          {/* Ambient breathing ring (subtle pulse around the timer) */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(closest-side, hsl(var(--primary) / 0.18), transparent 70%)",
              animation: "breathe 4s ease-in-out infinite",
            }}
          />
          <svg width="260" height="260" className={lowTime ? "ring-pulse rounded-full relative" : "relative"}>
            <circle cx="130" cy="130" r={radius} stroke="hsl(var(--border))" strokeWidth="6" fill="none" />
            <circle cx="130" cy="130" r={radius} stroke="hsl(var(--primary))" strokeWidth="6" fill="none" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 130 130)" style={{ transition: "stroke-dashoffset 240ms linear" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {showCheck ? (
              <div className="h-20 w-20 rounded-full bg-success flex items-center justify-center check-pop">
                <Check className="h-10 w-10 text-success-foreground" strokeWidth={3} />
              </div>
            ) : timeUp ? (
              <div className="text-center">
                <div className="text-[28px] font-mono-sf font-semibold tabular-nums leading-none text-primary">Time's up</div>
                <div className="text-secondary-fg text-xs mt-2">Need a little more?</div>
              </div>
            ) : (
              <>
                <div className="text-[48px] font-mono-sf font-medium tabular-nums leading-none">
                  {String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}
                </div>
                <div className="text-secondary-fg text-sm mt-2">of {block.duration_min} minutes</div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-14 w-full">
          <button
            onClick={extendFiveMin}
            className={`h-12 px-3 rounded-xl text-sm font-medium pressable flex items-center gap-1.5 transition-colors ${
              timeUp
                ? "bg-primary/15 border-2 border-primary/50 text-primary shadow-glow"
                : "bg-surface border border-border"
            }`}
          >
            <Plus className="h-3.5 w-3.5" /> 5 min
          </button>
          <button onClick={complete} className="flex-1 h-13 py-3 rounded-xl bg-primary text-primary-foreground font-medium pressable shadow-glow flex items-center justify-center gap-2"
            style={{ background: "var(--gradient-primary)" }}>
            Complete <Check className="h-4 w-4" strokeWidth={3} />
          </button>
          <div className="shrink-0">
            <QuickCaptureButton variant="icon" />
          </div>
        </div>
        <button onClick={() => setConfirmSkipOpen(true)} className="mt-3 text-secondary-fg text-xs hover:text-foreground inline-flex items-center gap-1">
          Skip block <ChevronRight className="h-3 w-3" />
        </button>
        {!tracking && armed && categories.length > 0 && (
          <button
            onClick={() => {
              startedHereRef.current = true;
              startTracking(undefined, { source: "focus", blockId: block.id, note: block.title });
            }}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border text-[12px] text-secondary-fg hover:text-foreground pressable"
          >
            <Timer className="h-3.5 w-3.5" /> Start tracking
          </button>
        )}
        {tracking && startedHereRef.current && (
          <button
            onClick={() => { stopTracking(); startedHereRef.current = false; }}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border text-[12px] text-secondary-fg hover:text-foreground pressable"
          >
            <Square className="h-3.5 w-3.5" /> Stop tracking
          </button>
        )}
        <style>{`@keyframes breathe {
          0%, 100% { transform: scale(0.92); opacity: 0.55; }
          50% { transform: scale(1.05); opacity: 0.95; }
        }`}</style>

        <div className="mt-auto pt-10 text-secondary-fg text-[13px]">
          {next ? (
            <>Next up: <span className="text-foreground">{next.title}</span></>
          ) : block.kind === "task" ? (
            "Last block — finish strong."
          ) : block.kind === "lunch" ? (
            "Enjoy your lunch."
          ) : (
            "Take a real break."
          )}
        </div>

        {/* AI Assistant panel */}
        <div className="w-full mt-6">
          {!helpOpen ? (
            <button
              onClick={loadHelp}
              className="w-full h-11 rounded-xl bg-surface border border-border text-sm font-medium pressable inline-flex items-center justify-center gap-2 text-foreground"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              Ask AI to help with this task
            </button>
          ) : (
            <div className="rounded-2xl border border-border bg-surface p-4 space-y-3 text-left">
              <div className="flex items-center gap-2 text-xs font-medium text-primary uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" /> AI Assistant
              </div>
              {block.location && (
                <a
                  href={mapsUrl(block.location, block.location_lat, block.location_lng)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-foreground bg-background rounded-xl px-3 py-2 border border-border pressable"
                >
                  <MapPin className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate flex-1">{block.location}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-secondary-fg" />
                </a>
              )}
              {/* Contextual quick actions */}
              {(isCall || isMeeting || isEmail) && (
                <div className="flex gap-1.5 flex-wrap">
                  {isCall && (
                    <a href={telUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-foreground pressable">
                      <Phone className="h-3.5 w-3.5 text-primary" /> Call
                    </a>
                  )}
                  {isMeeting && (
                    <a href={calendarUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-foreground pressable">
                      <CalendarPlus className="h-3.5 w-3.5 text-primary" /> Add to calendar
                    </a>
                  )}
                  {isEmail && (
                    <a href={mailtoUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-foreground pressable">
                      <Mail className="h-3.5 w-3.5 text-primary" /> New email
                    </a>
                  )}
                </div>
              )}
              {helpLoading && (
                <div className="flex items-center gap-2 text-sm text-secondary-fg py-3 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
              {helpError && (
                <div className="text-sm text-destructive">{helpError}</div>
              )}
              {help && (
                <>
                  {help.draft && (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/20">
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary font-medium">
                          <Mail className="h-3 w-3" /> Draft
                        </div>
                        <button onClick={copyDraft} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary pressable">
                          <Copy className="h-3 w-3" /> Copy
                        </button>
                      </div>
                      <div className="px-3 py-2.5 text-sm space-y-1">
                        {help.draft.subject && (
                          <div className="text-foreground"><span className="text-secondary-fg text-xs">Subject: </span>{help.draft.subject}</div>
                        )}
                        <pre className="whitespace-pre-wrap font-sans text-foreground text-[13px] leading-relaxed">{help.draft.body}</pre>
                      </div>
                    </div>
                  )}
                  {help.substeps?.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-1.5">Steps</div>
                      <ol className="space-y-1.5">
                        {help.substeps.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                            <span className="text-foreground">{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {help.links?.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-1.5">Useful links</div>
                      <div className="space-y-1">
                        {help.links.map((l, i) => (
                          <a
                            key={i}
                            href={l.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{l.label}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {help.tip && (
                    <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 text-sm text-foreground">
                      <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{help.tip}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <PreflightSheet open={preflightOpen} onOpenChange={(v) => { if (!v) dismissPreflight(); }} onStart={dismissPreflight} />
      <AlertDialog open={confirmSkipOpen} onOpenChange={setConfirmSkipOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this block?</AlertDialogTitle>
            <AlertDialogDescription>
              "{block?.title}" will be marked as done and you'll move to the next block. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmSkipOpen(false); skip(); }}>Skip</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
