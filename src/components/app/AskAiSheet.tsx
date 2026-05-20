import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * `seedContext` is a hidden hint that frames the conversation for the AI
 * (e.g. "the user is looking at an empty day"). It is NOT shown in the
 * textarea — earlier versions dumped this raw instruction into the input,
 * which looked like a weird half-written prompt to the user.
 */
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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setInput(initialPrompt || "");
      setMessages([]);
    }
  }, [open, initialPrompt, seedContext]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      // Inject the seed context as a hidden first user turn so the
      // assistant has framing without exposing the meta-prompt to the user.
      const payload: Msg[] = seedContext
        ? [{ role: "user", content: `Context for the conversation (not shown to user): ${seedContext}` }, ...next]
        : next;
      const { data, error } = await supabase.functions.invoke("ai-assist", {
        body: { messages: payload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const reply = String(data?.reply || "").trim();
      if (!reply) throw new Error("Empty reply");
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      toast.error(e?.message || "AI is unavailable");
    } finally {
      setLoading(false);
    }
  };

  // Contextual quick prompts. We pick a small set based on the seed context
  // so the suggestions feel relevant to whatever the user just tapped.
  const quickPrompts = useMemo<{ label: string; prompt: string; send?: boolean }[]>(() => {
    const ctx = (seedContext || "").toLowerCase();
    if (ctx.includes("empty day")) {
      return [
        { label: "Help me decide what to focus on today", prompt: "Ask me 2-3 quick questions to help me decide what to focus on today.", send: true },
        { label: "Suggest a balanced day structure", prompt: "Suggest a balanced shape for a productive day (deep work, breaks, admin) without scheduling anything for me.", send: true },
        { label: "How do I avoid overcommitting?", prompt: "How do I pick a realistic number of tasks for one day without overcommitting?", send: true },
      ];
    }
    if (ctx.includes("this task")) {
      return [
        { label: "Estimate realistic time", prompt: "Give a realistic time estimate for this task and explain the assumption in one line.", send: true },
        { label: "Break it into 3-5 steps", prompt: "Break this task into 3-5 concrete, ordered steps I can check off.", send: true },
        { label: "Best time of day for it", prompt: "When in the day is this task usually best to do, and why?", send: true },
      ];
    }
    // Default: looking at an existing plan
    return [
      { label: "Spot one weak spot in my day", prompt: "Look at my current day and point out one weak spot or risk — just advice, don't change anything.", send: true },
      { label: "Where should I add a break?", prompt: "Where in my current day would a short break help most, and why?", send: true },
      { label: "Estimate time for…", prompt: "Estimate time for: " },
      { label: "Break a task into steps…", prompt: "Break this task into steps: " },
    ];
  }, [seedContext]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[28px] border-border/45 bg-popover h-[85vh] flex flex-col p-0">
        <SheetHeader className="px-5 pt-5 pb-3 text-left shrink-0">
          <SheetTitle className="flex items-center gap-2 text-[16px]">
            <Sparkles className="h-4 w-4 text-primary" /> Ask AI
          </SheetTitle>
          <p className="text-[12px] text-secondary-fg/80">
            A helper, not a planner. Ideas only — you decide what goes on the day.
          </p>
        </SheetHeader>

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 space-y-3">
          {messages.length === 0 && !loading && (
            <div className="space-y-2.5 pt-1">
              <p className="text-[11px] uppercase tracking-wider text-secondary-fg/70 font-medium px-1">
                Try one of these
              </p>
              {quickPrompts.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    if (p.send) {
                      void send(p.prompt);
                    } else {
                      setInput(p.prompt);
                    }
                  }}
                  className="w-full text-left px-3.5 py-3 rounded-2xl border border-border/40 bg-white/[0.03] dark:bg-white/[0.04] text-[13px] text-foreground/95 hover:bg-white/[0.08] pressable transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              // Slide-up + fade in per bubble so new replies land organically
              // instead of snapping into place. tailwind-animate utilities
              // already drive the keyframes; we just stage them per bubble.
              className={`bubble-in max-w-[88%] rounded-[20px] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-gradient-primary text-primary-foreground shadow-[0_4px_12px_hsl(var(--primary)/0.25)] border border-primary/20"
                  : "bg-surface-card border border-border/30 text-foreground/95"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-secondary-fg/80">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Thinking…
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border/30 bg-background/60 backdrop-blur-md">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask anything about your day…"
              rows={1}
              className="resize-none min-h-[40px] max-h-32 rounded-xl bg-card border-border/40 text-[13px] focus:ring-1 focus:ring-primary/25 placeholder:text-secondary-fg/50"
            />
            <Button
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="h-10 w-10 p-0 rounded-xl bg-gradient-primary text-primary-foreground hover:opacity-95 shadow-[0_4px_12px_hsl(var(--primary)/0.25)] pressable shrink-0"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}