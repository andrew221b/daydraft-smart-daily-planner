import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { useAbortOnUnmount } from "@/hooks/useAbortOnUnmount";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Msg = { role: "user" | "assistant"; content: string };

function ChatInput({
  onSend,
  loading,
  externalValue,
}: {
  onSend: (text: string) => void;
  loading: boolean;
  externalValue: string;
}) {
  const [val, setVal] = useState("");

  // Sync when external context/prompts push a new value
  useEffect(() => {
    if (externalValue) setVal(externalValue);
  }, [externalValue]);

  return (
    <div
      className="shrink-0 px-4 pt-3 border-t border-white/10 dark:border-white/5 bg-background/70 backdrop-blur-xl"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
    >
      <div className="flex items-end gap-2">
        <Textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (val.trim() && !loading) {
                onSend(val);
                setVal("");
              }
            }
          }}
          placeholder="Ask anything about your day…"
          rows={1}
          className="resize-none min-h-[44px] max-h-32 rounded-[20px] bg-white/50 dark:bg-black/20 border-black/5 dark:border-white/10 text-[14px] focus:ring-1 focus:ring-primary/30 placeholder:text-secondary-fg/50 px-4 py-3 shadow-sm"
        />
        <Button
          onClick={() => {
            if (val.trim() && !loading) {
              onSend(val);
              setVal("");
            }
          }}
          disabled={loading || !val.trim()}
          className="h-[44px] w-[44px] p-0 rounded-[20px] bg-gradient-primary text-primary-foreground hover:opacity-95 shadow-[0_4px_16px_hsl(var(--primary)/0.3)] pressable shrink-0"
          aria-label="Send"
        >
          <Send className="h-4 w-4 ml-1 mt-0.5" />
        </Button>
      </div>
    </div>
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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [presetInput, setPresetInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const getSignal = useAbortOnUnmount();

  useEffect(() => {
    if (open) {
      setPresetInput(initialPrompt || "");
      setMessages([]);
    }
  }, [open, initialPrompt, seedContext]);

  // Auto-scroll when messages change or loading starts
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setLoading(true);
    const signal = getSignal();

    try {
      const payload: Msg[] = seedContext
        ? [{ role: "user", content: `Context for the conversation (not shown to user): ${seedContext}` }, ...next]
        : next;

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-assist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ messages: payload }),
        signal,
      });

      if (!res.ok) throw new Error("AI gateway error");

      setLoading(false); // Stop generic spinner, start streaming
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; 
        
        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const parsed = JSON.parse(line.slice(6));
              const textChunk = parsed.choices?.[0]?.delta?.content || "";
              if (textChunk) {
                setMessages((m) => {
                  const newM = [...m];
                  newM[newM.length - 1] = { ...newM[newM.length - 1], content: newM[newM.length - 1].content + textChunk };
                  return newM;
                });
              }
            } catch (e) {
              // ignore incomplete chunks
            }
          }
        }
      }
    } catch (e: any) {
      if (signal.aborted) return;
      toast.error(e?.message || "AI is unavailable");
      setMessages((m) => {
        // Remove the empty assistant message if it failed mid-stream
        if (m[m.length - 1]?.role === "assistant" && !m[m.length - 1].content) {
          return m.slice(0, -1);
        }
        return m;
      });
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

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
    return [
      { label: "Spot one weak spot in my day", prompt: "Look at my current day and point out one weak spot or risk — just advice, don't change anything.", send: true },
      { label: "Where should I add a break?", prompt: "Where in my current day would a short break help most, and why?", send: true },
      { label: "Estimate time for…", prompt: "Estimate time for: " },
      { label: "Break a task into steps…", prompt: "Break this task into steps: " },
    ];
  }, [seedContext]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[32px] border-border/40 bg-popover/95 backdrop-blur-3xl h-[85vh] flex flex-col p-0 shadow-2xl">
        <SheetHeader className="px-6 pt-6 pb-4 text-left shrink-0 border-b border-border/20">
          <SheetTitle className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            Ask AI
          </SheetTitle>
          <p className="text-[13px] text-secondary-fg/70 leading-relaxed mt-1">
            A helper, not a planner. Ideas only — you decide what goes on the day.
          </p>
        </SheetHeader>

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 space-y-4 pt-4">
          {messages.length === 0 && !loading && (
            <div className="space-y-3 pt-2">
              <p className="text-[12px] uppercase tracking-wider text-secondary-fg/60 font-semibold px-2">
                Try one of these
              </p>
              <div className="flex flex-col gap-2">
                {quickPrompts.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      if (p.send) {
                        void send(p.prompt);
                      } else {
                        setPresetInput(p.prompt);
                      }
                    }}
                    className="w-full text-left px-4 py-3.5 rounded-[20px] border border-border/30 bg-white/[0.04] dark:bg-white/[0.03] text-[13.5px] font-medium text-foreground/90 hover:bg-white/[0.08] pressable transition-all"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {messages.map((m, i) => (
            <div
              key={i}
              className={`bubble-in max-w-[85%] rounded-[22px] px-4 py-3 text-[14px] leading-[1.6] whitespace-pre-wrap shadow-sm ${
                m.role === "user"
                  ? "ml-auto bg-gradient-primary text-primary-foreground shadow-[0_4px_14px_hsl(var(--primary)/0.25)] border border-primary/20 rounded-tr-[8px]"
                  : "bg-surface-card border border-border/40 text-foreground/95 rounded-tl-[8px]"
              }`}
            >
              {m.content || <span className="opacity-50 animate-pulse">● ● ●</span>}
            </div>
          ))}
          
          {loading && (
            <div className="flex items-center gap-2.5 text-[13px] text-secondary-fg/70 pl-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Loader2 className="h-4 w-4 animate-spin text-primary/70" /> Thinking…
            </div>
          )}
        </div>

        <ChatInput onSend={send} loading={loading} externalValue={presetInput} />
      </SheetContent>
    </Sheet>
  );
}