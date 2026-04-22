import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Block } from "@/lib/daydraft";
import { Check, ChevronRight, Minus, Sparkles, MapPin, ExternalLink, Loader2, Lightbulb, Copy, Phone, CalendarPlus, Mail } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { mapsUrl } from "@/lib/maps";
import { toast } from "sonner";
import { useTimeTracker, fmtHMS } from "@/hooks/useTimeTracker";

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

  useEffect(() => {
    if (!blockId || !user) return;
    (async () => {
      const { data } = await supabase.from("blocks").select("*").eq("id", blockId).maybeSingle();
      if (!data) { nav("/today/plan"); return; }
      setBlock(data as Block);
      setTotal(data.duration_min * 60);
      setRemaining(data.duration_min * 60);
      const { data: rest } = await supabase.from("blocks").select("*").eq("plan_id", data.plan_id)
        .eq("kind", "task").eq("completed", false).gt("position", data.position).order("position").limit(1);
      setNext((rest?.[0] as Block) || null);
    })();
  }, [blockId, user?.id]);

  useEffect(() => {
    if (!block) return;
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
  }, [block?.id]);

  useEffect(() => { if (block && remaining <= 0) complete(); /* eslint-disable-line */ }, [remaining]);

  // Auto-start time tracking when entering Focus, stop when leaving (only if started here)
  const startedHereRef = useRef(false);
  useEffect(() => {
    if (!block || !categories.length) return;
    if (tracking) return; // honor existing session
    startedHereRef.current = true;
    startTracking(undefined, { source: "focus", blockId: block.id, note: block.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.id, categories.length]);

  useEffect(() => {
    return () => {
      if (startedHereRef.current && tracking) stopTracking();
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
    setShowCheck(true);
    await supabase.from("blocks").update({ completed: true }).eq("id", block.id);
    setTimeout(() => {
      if (next) nav(`/focus/${next.id}`);
      else nav("/recap");
    }, 800);
  };

  const skip = async () => {
    if (!block) return;
    await supabase.from("blocks").update({ completed: true }).eq("id", block.id);
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

        <h1 className="mt-12 text-[28px] font-semibold text-center leading-tight max-w-[300px] line-clamp-2">{block.title}</h1>

        <div className="relative mt-12">
          <svg width="260" height="260" className={lowTime ? "ring-pulse rounded-full" : ""}>
            <circle cx="130" cy="130" r={radius} stroke="hsl(var(--border))" strokeWidth="6" fill="none" />
            <circle cx="130" cy="130" r={radius} stroke="hsl(var(--primary))" strokeWidth="6" fill="none" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 130 130)" style={{ transition: "stroke-dashoffset 240ms linear" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {showCheck ? (
              <div className="h-20 w-20 rounded-full bg-success flex items-center justify-center check-pop">
                <Check className="h-10 w-10 text-success-foreground" strokeWidth={3} />
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
          <button onClick={() => setRemaining(r => Math.max(0, r - 300))} className="h-12 px-4 rounded-xl bg-surface border border-border text-sm font-medium pressable flex items-center gap-1.5">
            <Minus className="h-3.5 w-3.5" /> 5 min
          </button>
          <button onClick={complete} className="flex-1 h-13 py-3 rounded-xl bg-primary text-primary-foreground font-medium pressable shadow-glow flex items-center justify-center gap-2"
            style={{ background: "var(--gradient-primary)" }}>
            Complete <Check className="h-4 w-4" strokeWidth={3} />
          </button>
          <button onClick={skip} className="h-12 px-4 rounded-xl bg-surface border border-border text-sm font-medium pressable flex items-center gap-1.5">
            Skip <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-auto pt-10 text-secondary-fg text-[13px]">
          {next ? <>Next up: <span className="text-foreground">{next.title}</span></> : "Last block — finish strong."}
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
    </div>
  );
}
