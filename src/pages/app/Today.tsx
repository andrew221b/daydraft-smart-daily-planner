import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "@/components/app/Shell";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { greeting, friendlyDate, peakWindow, todayDateStr } from "@/lib/daydraft";
import { supabase } from "@/integrations/supabase/client";
import { ClipboardPaste, Mic, Sparkles, Zap, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const placeholder = `Drop your tasks here...

e.g. Write proposal, Reply to Alex, Fix login bug, Team standup, Review contracts`;

export default function Today() {
  const { profile } = useProfile();
  const { user } = useAuth();
  const nav = useNavigate();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasToday, setHasToday] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("plans").select("id").eq("user_id", user.id).eq("date", todayDateStr()).maybeSingle()
      .then(({ data }) => setHasToday(!!data));
  }, [user?.id]);

  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); setInput(prev => prev ? prev + "\n" + t : t); }
    catch { toast.error("Clipboard unavailable"); }
  };

  const useYesterday = async () => {
    if (!user) return;
    const { data } = await supabase.from("plans").select("raw_input").eq("user_id", user.id)
      .lt("date", todayDateStr()).order("date", { ascending: false }).limit(1).maybeSingle();
    if (data?.raw_input) { setInput(data.raw_input); toast.success("Loaded yesterday's tasks"); }
    else toast("No previous tasks found");
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice input not supported in this browser"); return; }
    const r = new SR(); r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e: any) => setInput(prev => prev + (prev ? "\n" : "") + e.results[0][0].transcript);
    r.onerror = () => toast.error("Couldn't capture voice");
    r.start();
    toast("Listening...");
  };

  const plan = async () => {
    if (!input.trim()) { toast.error("Add at least one task"); return; }
    if (!user || !profile) return;
    setBusy(true);
    sessionStorage.setItem("dd_planning_input", input);
    nav("/today/planning");
    try {
      const minWait = new Promise(r => setTimeout(r, 1500));
      const { data, error } = await supabase.functions.invoke("generate-plan", {
        body: { raw_input: input, energy_preference: profile.energy_preference, name: profile.display_name },
      });
      await minWait;
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // upsert plan
      const today = todayDateStr();
      const { data: planRow, error: planErr } = await supabase.from("plans").upsert({
        user_id: user.id, date: today, raw_input: input, ai_summary: data.summary, ai_subtext: data.subtext,
      }, { onConflict: "user_id,date" }).select().single();
      if (planErr) throw planErr;

      await supabase.from("blocks").delete().eq("plan_id", planRow.id);
      const blocks = (data.blocks || []).map((b: any, i: number) => ({
        plan_id: planRow.id, user_id: user.id,
        start_time: b.start_time, duration_min: b.duration_min, title: b.title,
        type: b.type, kind: b.kind, position: i,
      }));
      if (blocks.length) await supabase.from("blocks").insert(blocks);
      nav("/today/plan");
    } catch (e: any) {
      toast.error(e.message || "Planning failed");
      nav("/today");
    } finally { setBusy(false); }
  };

  return (
    <Shell>
      <div className="px-6 pt-12">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight">{greeting()}{profile?.display_name ? `, ${profile.display_name}` : ""}</h1>
            <p className="text-secondary-fg text-sm mt-1">{friendlyDate()}</p>
          </div>
          <div className="h-10 w-10 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-sm font-medium text-secondary-fg">
            {(profile?.display_name || "·").slice(0,1).toUpperCase()}
          </div>
        </div>

        <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 shadow-glow">
          <Zap className="h-3.5 w-3.5 text-primary" fill="currentColor" />
          <span className="text-xs font-medium text-primary">Peak hours: {peakWindow(profile?.energy_preference || "morning")}</span>
        </div>

        <div className="mt-6 relative">
          <Textarea
            value={input} onChange={e => setInput(e.target.value)} placeholder={placeholder}
            className="min-h-[200px] bg-surface border-border rounded-[20px] p-4 text-base leading-relaxed resize-none focus-visible:ring-primary/40 focus-visible:ring-offset-0 focus-visible:border-primary/40 transition-all" />
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          <button onClick={paste} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground">
            <ClipboardPaste className="h-3.5 w-3.5" /> Paste
          </button>
          <button onClick={voice} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground">
            <Mic className="h-3.5 w-3.5" /> Voice
          </button>
          <button onClick={useYesterday} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Use yesterday's
          </button>
        </div>

        {hasToday && (
          <button onClick={() => nav("/today/plan")} className="mt-4 w-full text-left text-sm text-primary hover:underline">
            View today's existing plan →
          </button>
        )}

        <div className="mt-8">
          <Button onClick={plan} disabled={busy} className="w-full h-13 py-3.5 rounded-xl text-primary-foreground text-base font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            Plan My Day <ArrowRight className="h-4 w-4" />
          </Button>
          <p className="text-xs text-secondary-fg text-center mt-2">Usually takes 3 seconds</p>
        </div>
      </div>
    </Shell>
  );
}
