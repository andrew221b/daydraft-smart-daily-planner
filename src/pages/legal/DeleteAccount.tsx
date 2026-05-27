import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";
import { LegalLayout } from "./LegalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { triggerDownload } from "@/lib/reportExport";
import { toast } from "sonner";

export default function DeleteAccount() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!user || exporting) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-user-data");
      if (error) throw error;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const filename = `daydraft-export-${new Date().toISOString().slice(0, 10)}.json`;
      await triggerDownload(blob, filename, "application/json");
      toast.success("Export downloaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export failed";
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    if (confirm !== "DELETE") {
      toast.error('Type "DELETE" to confirm');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("delete-account", {
        body: { confirm: "DELETE" },
      });
      if (error) throw error;
      toast.success("Your account has been deleted. Signing out…");
      await signOut();
      nav("/auth", { replace: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to delete. Email support@daydraft.app";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <LegalLayout title="Delete your account">
      <p>This action is <strong>permanent</strong>. Deleting your account will erase:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>All your tasks, plans, and daily blocks</li>
        <li>Time tracking entries and categories</li>
        <li>Statistics and recaps</li>
        <li>Templates, quick captures, and notification subscriptions</li>
        <li>Saved billing & payment details</li>
        <li>Your profile and login</li>
      </ul>
      <p>You will not be able to recover this data. If you only want a break, you can sign out instead — your data will be preserved.</p>

      <div className="mt-8 p-4 rounded-2xl border border-border/35 hero-glass space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground">Before you go — grab a copy</p>
          <p className="text-xs text-secondary-fg mt-1">
            Download every plan, time entry, and category as a single JSON file. Safe to keep, easy to read.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={exporting}
          onClick={handleExport}
          className="w-full pressable"
        >
          {exporting
            ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing your export…</>)
            : (<><Download className="h-4 w-4 mr-2" /> Export my data</>)}
        </Button>
      </div>

      <div className="mt-6 p-4 rounded-2xl border border-destructive/30 bg-destructive/5 space-y-3">
        <label className="text-sm font-medium text-foreground">
          Type <span className="font-mono">DELETE</span> to confirm
        </label>
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="DELETE"
          className="surface-card"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
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
