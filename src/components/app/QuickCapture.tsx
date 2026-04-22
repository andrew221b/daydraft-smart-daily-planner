import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";

const HIDE_ON = ["/auth", "/onboarding", "/forgot-password", "/reset-password"];

export const QuickCapture = () => {
  const { user } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user || HIDE_ON.some(p => loc.pathname.startsWith(p))) return null;

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("quick_captures").insert({
      user_id: user.id, content: text.trim(),
    } as any);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    setOpen(false);
    toast.success("Captured · added to tomorrow");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Quick capture"
        className="fixed bottom-24 right-5 z-30 h-12 w-12 rounded-full text-primary-foreground flex items-center justify-center shadow-glow pressable"
        style={{ background: "var(--gradient-primary)" }}
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border bg-surface-elevated">
          <SheetHeader>
            <SheetTitle>Quick capture</SheetTitle>
          </SheetHeader>
          <p className="text-xs text-secondary-fg mt-1">Brain-dump now. We'll surface it on tomorrow's plan.</p>
          <Textarea
            autoFocus value={text} onChange={e => setText(e.target.value)}
            placeholder="A task, an idea, a follow-up..."
            className="mt-4 min-h-[140px] bg-surface border-border rounded-xl text-base"
          />
          <Button onClick={save} disabled={busy || !text.trim()}
            className="w-full mt-4 h-12 rounded-xl text-primary-foreground font-medium pressable shadow-glow"
            style={{ background: "var(--gradient-primary)" }}>
            Save to tomorrow
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
};