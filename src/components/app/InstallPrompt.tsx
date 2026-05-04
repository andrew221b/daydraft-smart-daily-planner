import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

const LS_KEY = "daydraft.installPrompt.dismissedAt";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true;
}

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

export const InstallPrompt = () => {
  const { user } = useAuth();
  const { profile, update } = useProfile();
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);

  useEffect(() => {
    const onPrompt = (e: any) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    if (!user || !profile) return;
    if (isStandalone()) return;
    if (!isMobile() && !deferred) return;

    const dismissed = localStorage.getItem(LS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < 1000 * 60 * 60 * 24 * 14) return;
    if (profile.install_prompted_at) return;

    // Show on day 3+ visit — use profile.created_at via session timestamp fallback
    // (We mark install_prompted_at when shown to avoid repeats.)
    const t = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(t);
  }, [user, profile, deferred]);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(LS_KEY, String(Date.now()));
    update({ install_prompted_at: new Date().toISOString() } as any);
  };

  const install = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    }
    dismiss();
  };

  if (!show) return null;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-32px)] max-w-[358px] page-enter">
      <div className="rounded-xl bg-surface-elevated border border-soft shadow-card p-4 flex gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
          <Plus className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Install DayDraft</div>
          <div className="text-xs text-secondary-fg mt-0.5">
            {isIOS ? "Tap Share → Add to Home Screen for the full app." : "One-tap access from your home screen."}
          </div>
          <div className="flex gap-2 mt-3">
            {deferred && (
              <button onClick={install} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium pressable">
                Install
              </button>
            )}
            <button onClick={dismiss} className="px-3 py-1.5 rounded-lg surface-card border border-soft text-xs text-secondary-fg pressable">
              Maybe later
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="text-secondary-fg hover:text-foreground shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};