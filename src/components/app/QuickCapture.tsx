import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Inbox, Sunrise, Sun, Trash2, Mic } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Capture = { id: string; content: string; consumed: boolean; created_at: string };

export function QuickCaptureButton({ className = "", variant = "icon" }: { className?: string; variant?: "icon" | "chip" }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState<"tomorrow" | "today">("tomorrow");
  const [items, setItems] = useState<Capture[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const refresh = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("quick_captures")
      .select("id, content, consumed, created_at")
      .eq("user_id", user.id)
      .eq("consumed", false)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data || []) as Capture[]);
    setPendingCount((data || []).length);
  };

  useEffect(() => { refresh(); }, [user?.id]);
  useEffect(() => { if (open) refresh(); }, [open]);

  const save = async () => {
    if (!text.trim() || !user) return;
    setBusy(true);
    // Add a marker prefix when destination is "today" so Today screen can pick it up immediately
    const content = destination === "today" ? `[today] ${text.trim()}` : text.trim();
    const { error } = await supabase.from("quick_captures").insert({
      user_id: user.id, content,
    } as any);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    toast.success(destination === "today" ? "Captured · added to today" : "Captured · added to tomorrow");
    refresh();
  };

  const remove = async (id: string) => {
    await supabase.from("quick_captures").delete().eq("id", id);
    setItems(i => i.filter(x => x.id !== id));
    setPendingCount(c => Math.max(0, c - 1));
  };

  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice not supported in this browser"); return; }
    const r = new SR(); r.lang = "en-US"; r.interimResults = false;
    r.onresult = (e: any) => setText(prev => prev + (prev ? " " : "") + e.results[0][0].transcript);
    r.onerror = () => toast.error("Couldn't capture voice");
    r.start();
    toast("Listening…");
  };

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-tour="today-inbox"
        aria-label={`Inbox · ${pendingCount} pending`}
        className={variant === "chip"
          ? `shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-surface border border-border text-xs text-secondary-fg pressable hover:text-foreground ${className}`
          : `relative h-10 w-10 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-secondary-fg hover:text-foreground pressable ${className}`}
      >
        <Inbox className={variant === "chip" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.2} />
        {variant === "chip" && <span>Inbox</span>}
        {pendingCount > 0 && (
          variant === "chip"
            ? <span className="inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold items-center justify-center">{pendingCount > 99 ? "99+" : pendingCount}</span>
            : <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center border-2 border-background">{pendingCount > 99 ? "99+" : pendingCount}</span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated max-h-[90vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="text-xl">Inbox</SheetTitle>
            <SheetDescription className="text-xs">
              Capture thoughts as they come. They'll appear on your next plan automatically.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5">
            <div className="relative">
              <Textarea
                autoFocus value={text} onChange={e => setText(e.target.value)}
                placeholder="A task, an idea, a follow-up…"
                className="min-h-[100px] bg-surface border-border rounded-xl text-base pr-12"
              />
              <button
                onClick={voice}
                aria-label="Voice capture"
                className="absolute right-3 top-3 h-8 w-8 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-secondary-fg hover:text-primary pressable"
              >
                <Mic className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setDestination("today")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium pressable ${
                  destination === "today" ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-secondary-fg"
                }`}
              >
                <Sun className="h-3.5 w-3.5" /> Today
              </button>
              <button
                onClick={() => setDestination("tomorrow")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium pressable ${
                  destination === "tomorrow" ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-secondary-fg"
                }`}
              >
                <Sunrise className="h-3.5 w-3.5" /> Tomorrow
              </button>
            </div>

            <Button onClick={save} disabled={busy || !text.trim()}
              className="w-full mt-3 h-12 rounded-xl text-primary-foreground font-medium pressable shadow-glow"
              style={{ background: "var(--gradient-primary)" }}>
              Capture
            </Button>
          </div>

          {items.length > 0 && (
            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-wider text-secondary-fg mb-2 px-1">
                Pending · {items.length}
              </div>
              <div className="space-y-1.5">
                {items.map(it => {
                  const forToday = it.content.startsWith("[today]");
                  const display = forToday ? it.content.replace(/^\[today\]\s*/, "") : it.content;
                  return (
                    <div key={it.id} className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-surface border border-border">
                      {forToday
                        ? <Sun className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                        : <Sunrise className="h-3.5 w-3.5 text-secondary-fg mt-0.5 shrink-0" />}
                      <p className="flex-1 text-sm leading-snug whitespace-pre-wrap break-words">{display}</p>
                      <button onClick={() => remove(it.id)} aria-label="Delete" className="text-secondary-fg hover:text-destructive pressable shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-secondary-fg text-center mt-3">
                These will appear in your input next time you plan.
              </p>
            </div>
          )}

          {items.length === 0 && (
            <div className="mt-8 text-center py-6">
              <Inbox className="h-8 w-8 text-secondary-fg/40 mx-auto mb-2" />
              <p className="text-xs text-secondary-fg">No captured ideas yet.</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

// Backwards-compatible default export — the floating version is no longer rendered.
// Kept as a no-op so any old imports don't crash.
export const QuickCapture = () => null;