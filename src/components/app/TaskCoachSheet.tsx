import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sparkles, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchWithRetry, isNetworkError } from "@/lib/aiCache";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useProfileData } from "@/hooks/useProfile";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { useSheetSwipeDown } from "@/hooks/useSheetSwipeDown";
import { haptics } from "@/lib/haptics";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { AskAiPaywall, buildUserFacts } from "@/components/app/AskAiSheet";

/**
 * Per-task "Coach" popup. NOT a chat — one shot. When the user taps the Coach
 * tile on a task, we fire a single AI call and render a short, specific brief
 * for that one task: a quick read on what it needs, 2–3 practical tips, and a
 * line of motivation. No input box, no back-and-forth — just something useful
 * the moment they open it. (The day-level "Ask AI" button is still the full
 * conversational chat; this is deliberately the opposite of that.)
 */
// Rotating analytical lenses. One is picked at random each time the brief is
// generated (incl. Regenerate), so opening the coach twice — even on the same
// task — leans on a different angle instead of repeating the same advice. Free
// variety: no extra tokens, no model change.
const COACH_LENSES = [
  "the specific way a task like this tends to go sideways, and how to dodge it",
  "where this sits in my day and what that timing means for how to approach it",
  "the one move that makes the rest of this task fall into place",
  "what 'good enough' actually looks like here, so I don't over-polish it or rush it",
  "the exact first few minutes — the smallest concrete action that breaks the inertia",
  "how to finish this cleanly so it sets up whatever comes next in my day",
  "the hidden cost if this slips, and why it's worth doing now rather than later",
];

const buildCoachPrompt = (title: string, lens: string) =>
  `Give me a short, sharp brief for this one task: "${title}".

First actually think about MY situation from the context: when it starts, how long it's set for, what I've already done today, and what's coming after it. The brief should read like it could only have been written for this exact task on this exact day — not advice you'd give for any task.

This time, lean into: ${lens}.

Write three short parts, plain text — no headings, no preamble, no sign-off:
1. One or two sentences of genuine read on this task — something specific and useful I might not have thought of, not advice I already know.
2. Two or three concrete tips to do it well and fast (each on its own line starting with "• ").
3. One short line that genuinely makes me want to start.

Reference the real details of this task. No generic productivity filler, no restating the task title back to me.`;

function CoachDots() {
  return (
    <span className="flex items-center gap-[5px] py-0.5">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="h-[6px] w-[6px] rounded-full bg-foreground/25 animate-bounce"
          style={{ animationDelay: `${delay}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  );
}

export function TaskCoachSheet({
  open,
  onOpenChange,
  taskTitle,
  seedContext,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskTitle?: string | null;
  seedContext?: string | null;
}) {
  const { isPro } = useEntitlement();
  const { profile } = useProfileData();
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const getSignal = useAbortOnUnmount();

  // Stream straight into a ref + batched rAF flush so a fast token stream
  // doesn't thrash React — same pattern the chat uses.
  const bufRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const seedRef = useRef(seedContext);
  useEffect(() => { seedRef.current = seedContext; }, [seedContext]);

  const run = useCallback(async (title: string) => {
    setText("");
    setErrored(false);
    setLoading(true);
    const signal = getSignal();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in to use Coach.");
      const token = session.access_token;
      const userFacts = buildUserFacts(profileRef.current, null);
      const rawSeed = seedRef.current || "";
      const seed = rawSeed === "__empty_day__" ? "" : rawSeed;
      const lens = COACH_LENSES[Math.floor(Math.random() * COACH_LENSES.length)];

      const res = await fetchWithRetry(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          messages: [{ role: "user", content: buildCoachPrompt(title, lens) }],
          userFacts,
          seedContext: seed,
        }),
        signal,
      });

      if (!res.ok) {
        let msg = "Coach is unavailable";
        try {
          const payload = await res.json();
          if (payload?.error && typeof payload.error === "string") msg = payload.error;
        } catch { /* non-JSON body */ }
        throw new Error(msg);
      }

      setLoading(false);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      bufRef.current = "";
      const decoder = new TextDecoder("utf-8");
      let lineBuf = "";
      const flush = () => {
        rafRef.current = null;
        const chunk = bufRef.current;
        if (!chunk) return;
        bufRef.current = "";
        setText((t) => t + chunk);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const piece: string = parsed.choices?.[0]?.delta?.content ?? "";
            if (piece) {
              bufRef.current += piece;
              if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush);
            }
          } catch { /* incomplete chunk */ }
        }
      }
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      flush();
    } catch (e: unknown) {
      if (signal.aborted) return;
      const raw = (e as Error)?.message || "";
      const friendly =
        isNetworkError(raw)
          ? "Couldn't reach the coach — check your connection and try again."
          : raw && !/AI gateway error/i.test(raw)
            ? raw
            : "Coach is unavailable — try again.";
      toast.error(friendly);
      setErrored(true);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [getSignal]);

  // Fire once each time the sheet opens for a task. Re-opening (or switching
  // task) re-runs; closing aborts via useAbortOnUnmount's signal rotation.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current && isPro && taskTitle) {
      void run(taskTitle);
    }
    if (!open) { setText(""); setErrored(false); setLoading(false); }
    prevOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const swipe = useSheetSwipeDown(() => onOpenChange(false));
  const shortTitle = taskTitle && taskTitle.length > 24 ? taskTitle.slice(0, 24) + "…" : taskTitle;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/60 bg-popover max-h-[82vh] flex flex-col p-0"
        style={{
          transition: swipe.sheetStyle ? swipe.sheetStyle.transition : undefined,
          ...(swipe.sheetStyle?.transform ? { transform: swipe.sheetStyle.transform } : null),
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Coach</SheetTitle>

        {/* Drag handle */}
        <div
          className="relative flex justify-center pt-[10px] pb-2 shrink-0 -mb-2"
          {...swipe.handleProps}
          aria-label="Swipe down to close"
          role="button"
        >
          <div className="h-1 w-9 rounded-full bg-foreground/15" aria-hidden />
        </div>

        {/* Header */}
        <div className="px-5 pt-2.5 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow shadow-[0_4px_14px_hsl(var(--primary)/0.32)]">
              <Sparkles className="h-[17px] w-[17px] text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold tracking-tight text-foreground leading-none">Coach</p>
              <p className="text-[12px] text-foreground/38 mt-[3px] leading-none">A quick, specific read on this task</p>
            </div>
            {shortTitle && (
              <div className="flex items-center gap-1.5 rounded-full bg-primary/[0.09] border border-primary/18 px-2.5 py-1 shrink-0 max-w-[42%]">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
                <span className="text-[11px] font-semibold text-primary/80 truncate">{shortTitle}</span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 h-px bg-border/12 mx-5" />

        {isPro ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
              {loading && !text ? (
                <div className="flex items-center gap-2.5 text-foreground/45">
                  <CoachDots />
                  <span className="text-[13px]">Thinking about this one…</span>
                </div>
              ) : errored && !text ? (
                <div className="flex flex-col items-start gap-3 pt-1">
                  <p className="text-[14px] text-foreground/70 leading-relaxed">
                    The coach couldn't put a brief together just now.
                  </p>
                  <button
                    type="button"
                    onClick={() => { if (taskTitle) void run(taskTitle); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/65 bg-foreground/[0.05] px-3.5 py-1.5 text-[13px] font-semibold text-foreground/85 pressable"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Try again
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-[14.5px] leading-[1.65] text-foreground/90 whitespace-pre-wrap">
                    {text}
                    {loading && <span className="inline-block w-[2px] h-[1.05em] align-[-0.15em] ml-0.5 bg-primary/60 animate-pulse" />}
                  </p>
                  {/* errored is only reachable here when partial text already streamed in —
                      a mid-stream drop must look different from a finished brief, or "Got it"
                      reads as if the answer were complete. */}
                  {errored && !loading && (
                    <div className="mt-3 flex items-start gap-2 rounded-2xl px-3.5 py-2.5 border border-amber-500/25 bg-amber-500/[0.07]">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-px" strokeWidth={2.2} />
                      <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-300/90">
                        Cut off before finishing — tap regenerate for the full brief.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="shrink-0 h-px bg-border/12" />

            <div
              className="shrink-0 flex items-center gap-2 px-5 pt-3"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)" }}
            >
              <button
                type="button"
                onClick={() => { haptics.selection(); if (taskTitle) void run(taskTitle); }}
                disabled={loading}
                aria-label="Regenerate"
                className="h-12 w-12 shrink-0 rounded-2xl border border-border/65 bg-foreground/[0.05] flex items-center justify-center text-foreground/70 pressable disabled:opacity-40 transition-opacity"
              >
                <RefreshCw className={`h-[18px] w-[18px] ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="h-12 flex-1 rounded-2xl bg-primary text-primary-foreground text-[15px] font-semibold pressable"
              >
                Got it
              </button>
            </div>
          </>
        ) : (
          <AskAiPaywall onUpgrade={() => { haptics.selection(); setUpgradeOpen(true); }} />
        )}
      </SheetContent>

      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </Sheet>
  );
}
