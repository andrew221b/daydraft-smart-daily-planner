import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

export function AskAiSheet({
  open,
  onOpenChange,
  initialPrompt,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPrompt?: string | null;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setInput(initialPrompt || "");
      if (!initialPrompt) setMessages([]);
    }
  }, [open, initialPrompt]);

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
      const { data, error } = await supabase.functions.invoke("ai-assist", {
        body: { messages: next },
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

  const quickPrompts = [
    "How should I order my tasks today?",
    "Estimate time for: ",
    "Break this task into steps: ",
  ];

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
            <div className="space-y-2 pt-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInput(p)}
                  className="w-full text-left px-3.5 py-2.5 rounded-2xl border border-border/40 bg-card/30 text-[13px] text-foreground/90 hover:bg-muted/40 pressable"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted/50 text-foreground/95"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-secondary-fg/80">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border/30 bg-background/60">
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
              className="resize-none min-h-[40px] max-h-32 rounded-xl bg-card border-border/40 text-[13px]"
            />
            <Button
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="h-10 w-10 p-0 rounded-xl shrink-0"
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