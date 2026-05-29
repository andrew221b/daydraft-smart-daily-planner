import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sparkles, ArrowUp, ChevronRight, Lock, Zap, Compass, Brain } from "lucide-react";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useProfileData } from "@/hooks/useProfile";
import { UpgradeSheet } from "@/components/app/UpgradeSheet";
import { useSheetSwipeDown } from "@/hooks/useSheetSwipeDown";
import { haptics } from "@/lib/haptics";

type Msg = { role: "user" | "assistant"; content: string };

// Isolated memoised input — local state never propagates to parent while typing,
// so streaming AI responses never cause the keyboard/caret to jump.
const ChatInput = memo(function ChatInput({
  onSend,
  loading,
  externalValue,
}: {
  onSend: (text: string) => void;
  loading: boolean;
  externalValue: string;
}) {
  const [val, setVal] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rafId = useRef<number | null>(null);
  const canSend = !!val.trim() && !loading;

  // Batch height adjustments in rAF to avoid layout thrash on every keystroke.
  const scheduleHeight = () => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    });
  };

  useEffect(() => {
    if (externalValue) {
      setVal(externalValue);
      requestAnimationFrame(scheduleHeight);
    }
  }, [externalValue]);

  const handleSend = () => {
    if (!canSend) return;
    onSend(val);
    setVal("");
    if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = "auto"; });
  };

  return (
    // bg-popover matches the sheet background exactly so the safe-area zone
    // below the input blends in instead of looking like a black strip.
    // translateZ(0) promotes the input region into its own GPU compositor
    // layer — on iOS WKWebView this prevents the first-keystroke jank where
    // the keyboard summon repaints the entire sheet.
    <div
      className="shrink-0 px-3 pt-2 bg-popover"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)",
        transform: "translateZ(0)",
        willChange: "transform",
      }}
    >
      <div className={[
        "flex items-center gap-2 rounded-[18px] border px-4 py-2 transition-[border-color,box-shadow] duration-150",
        canSend
          ? "border-primary/40 bg-primary/[0.04] shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]"
          : "border-border/55 bg-foreground/[0.05]",
      ].join(" ")}>
        <textarea
          ref={taRef}
          value={val}
          onChange={(e) => { setVal(e.target.value); scheduleHeight(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder="Ask anything about your day…"
          rows={1}
          className="flex-1 resize-none bg-transparent text-[14px] leading-[1.4] text-foreground placeholder:text-foreground/45 outline-none min-h-[22px] max-h-[120px] py-0"
          style={{ height: "22px" }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send"
          className={[
            "flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full pressable transition-[background-color,color,box-shadow] duration-200",
            canSend
              ? "bg-primary text-primary-foreground shadow-[0_4px_12px_hsl(var(--primary)/0.4)]"
              : "bg-foreground/[0.10] text-foreground/35",
          ].join(" ")}
        >
          <ArrowUp className="h-[15px] w-[15px]" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
});

function ThinkingDots() {
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

export function AskAiSheet({
  open,
  onOpenChange,
  initialPrompt,
  seedContext,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPrompt?: string | null;
  seedContext?: string | null;
}) {
  const { isPro } = useEntitlement();
  const { profile } = useProfileData();
  // Mirror the profile into a ref so `send` reads the latest value without
  // needing `profile` in its dependency array. Without this the useCallback
  // closure captures a stale profile (often null on first mount), and the AI
  // never sees the user's "About me" context.
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [presetInput, setPresetInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const getSignal = useAbortOnUnmount();

  const messagesRef = useRef<Msg[]>([]);
  const loadingRef = useRef(false);
  const seedContextRef = useRef(seedContext);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { seedContextRef.current = seedContext; }, [seedContext]);

  const streamBufRef = useRef("");
  const rafRef = useRef<number | null>(null);

  // Reset chat state ONLY when the sheet flips from closed → open. Previously
  // this fired on every prop change (initialPrompt, seedContext) which caused
  // an unnecessary re-render right when iOS WKWebView was still initialising
  // the soft keyboard — that wasted frame made the first keystroke feel like
  // it stalled. Now we snapshot `initialPrompt` only at the moment of opening.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setPresetInput(initialPrompt || "");
      setMessages([]);
    }
    prevOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages, loading]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || loadingRef.current) return;

    const next: Msg[] = [...messagesRef.current, { role: "user", content }];
    setMessages(next);
    setLoading(true);
    const signal = getSignal();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string);

      // Context goes in dedicated fields — the function folds them into the
      // system prompt. Sending them as fake "user" messages caused two
      // consecutive user turns which Gemini's chat API sometimes rejects.
      const personalContext = profileRef.current?.ai_context_custom?.trim() || "";
      const seedContext = seedContextRef.current || "";

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ messages: next, personalContext, seedContext }),
        signal,
      });

      if (!res.ok) {
        // Server now returns { error: "<user-friendly message>" } on failure.
        // Surface that exact text — it's already been translated server-side
        // (rate limit, safety filter, transient 5xx, etc.).
        let msg = "AI is unavailable";
        try {
          const payload = await res.json();
          if (payload?.error && typeof payload.error === "string") msg = payload.error;
        } catch { /* non-JSON body, fall back to generic */ }
        throw new Error(msg);
      }

      setLoading(false);
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      streamBufRef.current = "";
      const decoder = new TextDecoder("utf-8");
      let lineBuf = "";

      const flush = () => {
        rafRef.current = null;
        const chunk = streamBufRef.current;
        if (!chunk) return;
        streamBufRef.current = "";
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + chunk };
          return copy;
        });
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
            const textChunk: string = parsed.choices?.[0]?.delta?.content ?? "";
            if (textChunk) {
              streamBufRef.current += textChunk;
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
      // Translate raw fetch/network errors into something the user can act on.
      // iOS WKWebView surfaces network failures as "Load failed" / "TypeError"
      // which read like a crash; map those to a calm copy that hints at the
      // real cause (offline / flaky link).
      const raw = (e as Error)?.message || "";
      const friendly =
        /Load failed|Failed to fetch|NetworkError|TypeError|net::|ENOTFOUND|ECONNREFUSED/i.test(raw)
          ? "Couldn't reach the assistant — check your connection and try again."
          // Server-side message already user-friendly (rate limit, safety, etc.) —
          // pass it through verbatim. Fall back only if message is empty/raw.
          : raw && !/AI gateway error/i.test(raw)
            ? raw
            : "AI is unavailable — try again.";
      toast.error(friendly);
      setMessages((m) => {
        if (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content) return m.slice(0, -1);
        return m;
      });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [getSignal]);

  const quickPrompts = useMemo<{ label: string; hint: string; prompt: string; send?: boolean }[]>(() => {
    const ctx = (seedContext || "").toLowerCase();
    if (ctx.includes("empty day")) return [
      { label: "Help me decide what to focus on", hint: "AI asks a few questions, then you choose", prompt: "Ask me 2-3 quick questions to help me decide what to focus on today.", send: true },
      { label: "Suggest a balanced day structure", hint: "Deep work, breaks & admin in proportion", prompt: "Suggest a balanced shape for a productive day (deep work, breaks, admin) without scheduling anything for me.", send: true },
      { label: "How do I avoid overcommitting?", hint: "Practical tips for a realistic task count", prompt: "How do I pick a realistic number of tasks for one day without overcommitting?", send: true },
    ];
    if (ctx.includes("this task")) return [
      { label: "Estimate realistic time", hint: "Uses this task's details to estimate", prompt: "Give a realistic time estimate for this task and explain the assumption in one line.", send: true },
      { label: "Break it into 3–5 steps", hint: "Concrete subtasks you can check off", prompt: "Break this task into 3-5 concrete, ordered steps I can check off.", send: true },
      { label: "Best time of day for it", hint: "When this type of work fits best", prompt: "When in the day is this task usually best to do, and why?", send: true },
    ];
    return [
      { label: "Spot one weak spot in my day", hint: "Reads your plan — advice only, no changes", prompt: "Look at my current day and point out one weak spot or risk — just advice, don't change anything.", send: true },
      { label: "Where should I add a break?", hint: "Finds the best gap in your current schedule", prompt: "Where in my current day would a short break help most, and why?", send: true },
      { label: "Estimate time for a task", hint: "Type the task name and I'll estimate it", prompt: "Estimate time for: " },
      { label: "Break a task into steps", hint: "Type the task name and I'll break it down", prompt: "Break this task into steps: " },
    ];
  }, [seedContext]);

  const contextLabel = useMemo(() => {
    if (!seedContext) return null;
    if (seedContext.toLowerCase().includes("this task")) return "Task context";
    if (seedContext.toLowerCase().includes("empty day")) return "Today's plan";
    return "Day context";
  }, [seedContext]);

  const hasEmptyAssistant = messages.some((m) => m.role === "assistant" && m.content === "");
  const isEmpty = messages.length === 0 && !loading;

  const swipe = useSheetSwipeDown(() => onOpenChange(false));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/30 bg-popover h-[82vh] flex flex-col p-0 will-change-transform"
        style={{
          // Slide content up by keyboard height so the input stays above the
          // keyboard. padding-bottom steals from the inner flex layout
          // (fixed h-[82vh]) — no layout reflow outside the sheet.
          paddingBottom: "var(--keyboard-inset, 0px)",
          transition: swipe.sheetStyle
            ? swipe.sheetStyle.transition
            : "padding-bottom 220ms cubic-bezier(0.32, 0.72, 0, 1)",
          ...(swipe.sheetStyle?.transform ? { transform: swipe.sheetStyle.transform } : null),
        }}
        // iOS WKWebView fires a synthetic pointer event outside the sheet content
        // when the software keyboard opens — Radix Dialog interprets this as
        // "user tapped outside, close dialog". Prevent that spurious dismiss.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        // Don't steal focus on open. Radix's default focuses the first
        // interactive element which, on iOS WKWebView, queues a focus event
        // for the textarea — that work fights with the slide-up animation
        // and stalls the first tap. Letting the user's tap drive focus
        // makes the first keystroke instant.
        onOpenAutoFocus={(e) => e.preventDefault()}
        hideClose
      >
        <SheetTitle className="sr-only">Ask AI</SheetTitle>

        {/* ── Drag handle — swipe down to dismiss; visible affordance for it. ── */}
        <div
          className="relative flex justify-center pt-[10px] pb-2 shrink-0 -mb-2"
          {...swipe.handleProps}
          aria-label="Swipe down to close"
          role="button"
        >
          <div className="h-1 w-9 rounded-full bg-foreground/15" aria-hidden />
        </div>

        {/* ── Header ── */}
        <div className="px-5 pt-2.5 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow shadow-[0_4px_14px_hsl(var(--primary)/0.32)]">
              <Sparkles className="h-[17px] w-[17px] text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold tracking-tight text-foreground leading-none">Ask AI</p>
              <p className="text-[12px] text-foreground/38 mt-[3px] leading-none">Ideas only — you decide</p>
            </div>
            {contextLabel && (
              <div className="flex items-center gap-1.5 rounded-full bg-primary/[0.09] border border-primary/18 px-2.5 py-1 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
                <span className="text-[11px] font-semibold text-primary/80 whitespace-nowrap">{contextLabel}</span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 h-px bg-border/12 mx-5" />

        {/* ── Content ── */}
        {isPro ? (
          <>
            <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">

              {/* Empty state: use a flex-col so suggestions sit at the BOTTOM
                  of the scrollable area, close to the input — not floating at top. */}
              {isEmpty && (
                <div className="h-full min-h-[280px] flex flex-col justify-end px-4 pb-4">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-foreground/28 font-semibold px-1 pb-2">Suggestions</p>
                  <div className="space-y-2">
                    {quickPrompts.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => p.send ? void send(p.prompt) : setPresetInput(p.prompt)}
                        className="w-full text-left rounded-2xl border border-border/30 bg-surface/60 px-4 py-3 pressable transition-[border-color,background-color] duration-200 hover:border-primary/22 hover:bg-primary/[0.04]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium text-foreground/90 leading-snug">{p.label}</p>
                            <p className="text-[12px] text-foreground/38 mt-[3px] leading-snug">{p.hint}</p>
                          </div>
                          {p.send
                            ? <ChevronRight className="h-3.5 w-3.5 text-foreground/20 shrink-0" />
                            : <span className="text-[10px] text-primary/50 font-medium shrink-0">Edit →</span>
                          }
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Conversation */}
              {!isEmpty && (
                <div className="px-4 pt-3 pb-4 space-y-2.5">
                  {messages.map((m, i) => (
                    <div key={i} className={`bubble-in flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={[
                        "max-w-[84%] rounded-[18px] px-4 py-2.5 text-[14px] leading-[1.6] whitespace-pre-wrap",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.26)] rounded-tr-[6px]"
                          : "bg-surface text-foreground/95 border border-border/30 rounded-tl-[6px]",
                      ].join(" ")}>
                        {m.content || (m.role === "assistant" ? <ThinkingDots /> : null)}
                      </div>
                    </div>
                  ))}

                  {loading && !hasEmptyAssistant && (
                    <div className="flex justify-start bubble-in">
                      <div className="rounded-[18px] rounded-tl-[6px] bg-surface border border-border/30 px-4 py-3.5">
                        <ThinkingDots />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 h-px bg-border/12" />

            <ChatInput onSend={send} loading={loading} externalValue={presetInput} />
          </>
        ) : (
          <AskAiPaywall
            onUpgrade={() => { haptics.selection(); setUpgradeOpen(true); }}
          />
        )}
      </SheetContent>

      <UpgradeSheet open={upgradeOpen} onOpenChange={setUpgradeOpen} reason="feature" />
    </Sheet>
  );
}

/**
 * Premium paywall shown to free users when they open the AskAi sheet.
 * Mirrors the chat sheet's premium aesthetic — same drag handle, header,
 * and divider — so the upsell feels native to the sheet, not bolted on.
 * Sells what they'd get (three concrete bullets, each with an icon),
 * leaves the divider line so the sheet still has its three-row rhythm.
 */
function AskAiPaywall({ onUpgrade }: { onUpgrade: () => void }) {
  const PERKS = [
    { Icon: Brain,    label: "Conversational AI",      blurb: "Ask anything — about your day or the world." },
    { Icon: Compass,  label: "Smart, contextual help", blurb: "Time estimates, breakdowns, and grounded takes." },
    { Icon: Zap,      label: "Unlimited prompts",      blurb: "No daily caps, no rate-limited free tier." },
  ];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <div className="mt-2 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/[0.10] border border-primary/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
          <Lock className="h-3 w-3" /> Pro feature
        </span>
      </div>

      <h2 className="mt-5 font-display text-[26px] font-semibold tracking-tight text-foreground text-center leading-tight">
        Unlock the AI<br />companion
      </h2>
      <p className="mt-2 text-[13px] text-secondary-fg/80 text-center leading-relaxed max-w-[300px] mx-auto">
        DayDraft's AI lives inside Pro — a thoughtful assistant for your day, not just a chatbot.
      </p>

      <ul className="mt-6 space-y-2.5">
        {PERKS.map(({ Icon, label, blurb }) => (
          <li
            key={label}
            className="flex items-start gap-3 rounded-2xl border border-border/35 bg-card/35 px-3.5 py-3"
          >
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/[0.14] text-primary">
              <Icon className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-foreground/95 leading-tight">{label}</p>
              <p className="mt-0.5 text-[12px] text-secondary-fg/75 leading-snug">{blurb}</p>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onUpgrade}
        className="mt-6 w-full h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-glow text-primary-foreground text-[14px] font-semibold pressable shadow-[0_8px_28px_-8px_hsl(var(--primary)/0.55)]"
      >
        <span className="inline-flex items-center justify-center gap-2">
          <Sparkles className="h-4 w-4" />
          Upgrade to Pro
        </span>
      </button>
      <p className="mt-2.5 text-[11px] text-secondary-fg/60 text-center">
        Cancel anytime · 7-day free trial
      </p>
    </div>
  );
}
