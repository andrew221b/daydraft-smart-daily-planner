import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Block } from "@/lib/daydraft";
import { Check, ChevronRight, Minus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function Focus() {
  const { blockId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [block, setBlock] = useState<Block | null>(null);
  const [next, setNext] = useState<Block | null>(null);
  const [remaining, setRemaining] = useState<number>(0); // seconds
  const [total, setTotal] = useState<number>(1);
  const [showCheck, setShowCheck] = useState(false);
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
      </div>
    </div>
  );
}
