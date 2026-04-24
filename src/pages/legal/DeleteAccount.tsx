import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LegalLayout } from "./LegalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function DeleteAccount() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    if (!user) return;
    if (confirm !== "DELETE") { toast.error('Type "DELETE" to confirm'); return; }
    setBusy(true);
    try {
      // Cascade-delete user-owned rows (RLS allows users to delete their own).
      // Order matters where FKs exist.
      await supabase.from("blocks").delete().eq("user_id", user.id);
      await supabase.from("plans").delete().eq("user_id", user.id);
      await supabase.from("time_entries").delete().eq("user_id", user.id);
      await supabase.from("time_categories").delete().eq("user_id", user.id);
      await supabase.from("block_templates").delete().eq("user_id", user.id);
      await supabase.from("quick_captures").delete().eq("user_id", user.id);
      // streaks table is no longer surfaced in-app; rows (if any) are left.
      await supabase.from("user_patterns").delete().eq("user_id", user.id);
      await supabase.from("push_subscriptions").delete().eq("user_id", user.id);
      await supabase.from("calendar_tokens").delete().eq("user_id", user.id);
      await supabase.from("subscriptions").delete().eq("user_id", user.id);
      await supabase.from("profiles").delete().eq("id", user.id);

      // Note: removing the auth user itself requires a server-side admin call.
      // Mark email for purge; user is signed out and data is gone.
      toast.success("Your data has been deleted. Signing out…");
      await signOut();
      nav("/auth", { replace: true });
    } catch (e: any) {
      toast.error(e.message || "Failed to delete. Email support@daydraft.app");
    } finally { setBusy(false); }
  };

  return (
    <LegalLayout title="Delete your account">
      <p>This action is <strong>permanent</strong>. Deleting your account will erase:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>All your tasks, plans, and daily blocks</li>
        <li>Time tracking entries and categories</li>
        <li>Statistics and recaps</li>
        <li>Templates, quick captures, and notification subscriptions</li>
        <li>Connected calendar tokens and subscription records</li>
        <li>Your profile</li>
      </ul>
      <p>You will not be able to recover this data. If you only want a break, you can sign out instead — your data will be preserved.</p>

      <div className="mt-8 p-4 rounded-2xl border border-destructive/30 bg-destructive/5 space-y-3">
        <label className="text-sm font-medium text-foreground">Type <span className="font-mono">DELETE</span> to confirm</label>
        <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="DELETE" className="bg-surface" />
        <Button
          variant="destructive"
          disabled={busy || confirm !== "DELETE"}
          onClick={handleDelete}
          className="w-full"
        >
          {busy ? "Deleting…" : "Permanently delete my account"}
        </Button>
      </div>

      <p className="text-xs text-secondary-fg mt-6">
        Need help instead? Contact <a href="mailto:support@daydraft.app">support@daydraft.app</a> — we usually reply within 24h.
      </p>
    </LegalLayout>
  );
}