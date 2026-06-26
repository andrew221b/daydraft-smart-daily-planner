import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LifeBuoy, Bug, ArrowLeft, Send } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import * as DialogPrimitive from "@radix-ui/react-dialog";

type SupportType = "feedback" | "bug" | null;

export function SupportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [type, setType] = useState<SupportType>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      const id = setTimeout(() => {
        setType(null);
        setSubject("");
        setMessage("");
        setSending(false);
      }, 300);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Focus management
  useEffect(() => {
    if (type && open && subjectInputRef.current) {
      const id = setTimeout(() => {
        subjectInputRef.current?.focus();
      }, 400); // Wait for AnimatePresence transition
      return () => clearTimeout(id);
    }
  }, [type, open]);

  const handleSubmit = async () => {
    if (!type || !subject.trim() || !message.trim()) return;
    setSending(true);
    haptics.impact("light");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Unauthorized");

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-support-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ type, subject: subject.trim(), message: message.trim() }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message. Please try again later.");
      }

      haptics.notify("success");
      toast.success(type === "bug" ? "Bug report sent" : "Feedback sent", {
        description: "Thank you for helping us improve DayDraft!",
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Unable to send message");
    } finally {
      setSending(false);
    }
  };

  const handleTypeSelect = (t: SupportType) => {
    haptics.selection();
    setType(t);
  };

  const isFormValid = subject.trim().length > 0 && message.trim().length > 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(val) => {
      if (!sending) onOpenChange(val);
    }}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 sm:px-6">
              {/* Backdrop */}
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="absolute inset-0 bg-background/80 backdrop-blur-md"
                />
              </DialogPrimitive.Overlay>

              {/* Modal Container */}
              <DialogPrimitive.Content asChild forceMount onPointerDownOutside={(e) => {
                if (sending) e.preventDefault();
              }}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 12 }}
                  transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                  className="relative w-full max-w-[420px] rounded-[32px] bg-card/70 backdrop-blur-3xl shadow-[0_24px_48px_-12px_rgba(0,0,0,0.25)] border border-black/[0.08] dark:border-white/10 overflow-hidden flex flex-col"
                  style={{
                    maxHeight: "85vh",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.1), 0 24px 48px -12px rgba(0,0,0,0.25)"
                  }}
                >
                  <DialogPrimitive.Title className="sr-only">Help & Support</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="sr-only">Contact support for help or to leave feedback.</DialogPrimitive.Description>
                  
                  {/* Header */}
                  <div className="px-6 pt-6 pb-4 shrink-0 flex items-center justify-between border-b border-white/5">
                    <div className="flex items-center gap-3.5">
                      {type ? (
                        <button
                          type="button"
                          onClick={() => { haptics.selection(); setType(null); }}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05] pressable transition-colors hover:bg-foreground/[0.08]"
                          aria-label="Back"
                        >
                          <ArrowLeft className="h-5 w-5 text-foreground/80" />
                        </button>
                      ) : (
                        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-black/[0.03] to-black/[0.08] dark:from-white/[0.12] dark:to-white/[0.06] border border-black/[0.08] dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_8px_rgba(0,0,0,0.2)]">
                          <LifeBuoy className="h-[20px] w-[20px] text-foreground/80 drop-shadow-sm" strokeWidth={2} />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <motion.p
                          key={type || 'header'}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-[17px] font-semibold tracking-tight text-foreground leading-none"
                        >
                          {type === "bug" ? "Report a Bug" : type === "feedback" ? "Leave Feedback" : "Help & Support"}
                        </motion.p>
                        <motion.p
                          key={type || 'subheader'}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05 }}
                          className="text-[13px] text-foreground/50 mt-[4px] leading-none"
                        >
                          {type === "bug" ? "Help us squash it" : type === "feedback" ? "Tell us what you think" : "How can we help you today?"}
                        </motion.p>
                      </div>
                    </div>

                    {!type && (
                      <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="h-10 w-10 -mr-2 rounded-full flex items-center justify-center text-foreground/40 hover:text-foreground hover:bg-foreground/[0.06] transition-colors pressable shrink-0 text-[20px]"
                        aria-label="Close"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Content area with smooth height transition */}
                  <div className="flex-1 overflow-y-auto px-6 pt-5 pb-6">
                    <AnimatePresence mode="wait">
                      {!type ? (
                        <motion.div
                          key="menu"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                          className="space-y-3"
                        >
                          <button
                            type="button"
                            onClick={() => handleTypeSelect("feedback")}
                            className="w-full text-left rounded-[24px] border border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 p-4 pressable transition-all duration-200 hover:bg-primary/[0.04] hover:border-primary/20 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] backdrop-blur-lg"
                          >
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/[0.12] text-primary">
                                <LifeBuoy className="h-5 w-5" strokeWidth={2.2} />
                              </div>
                              <div>
                                <h3 className="text-[16px] font-semibold text-foreground/95 leading-tight">Leave Feedback</h3>
                                <p className="text-[13.5px] text-secondary-fg/75 mt-1 leading-snug">
                                  Feature requests, suggestions, or general thoughts.
                                </p>
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleTypeSelect("bug")}
                            className="w-full text-left rounded-[24px] border border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/20 p-4 pressable transition-all duration-200 hover:bg-destructive/[0.04] hover:border-destructive/20 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] backdrop-blur-lg"
                          >
                            <div className="flex items-center gap-4">
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-destructive/[0.12] text-destructive/90">
                                <Bug className="h-5 w-5" strokeWidth={2.2} />
                              </div>
                              <div>
                                <h3 className="text-[16px] font-semibold text-foreground/95 leading-tight">Report a Bug</h3>
                                <p className="text-[13.5px] text-secondary-fg/75 mt-1 leading-snug">
                                  Something broken or not working as expected?
                                </p>
                              </div>
                            </div>
                          </button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="form"
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                          className="flex flex-col h-full space-y-4"
                        >
                          <div className="space-y-2">
                            <label className="text-[13px] font-semibold text-secondary-fg px-1">Subject</label>
                            <input
                              ref={subjectInputRef}
                              type="text"
                              maxLength={100}
                              placeholder={type === "bug" ? "E.g. App crashes when saving task" : "E.g. Dark mode is too dark"}
                              value={subject}
                              onChange={(e) => setSubject(e.target.value)}
                              className="w-full h-[52px] rounded-2xl border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.03] dark:bg-white/[0.03] px-4 text-[15px] font-medium text-foreground outline-none focus:border-primary/50 focus:bg-primary/[0.02] transition-colors placeholder:text-foreground/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
                              style={{ fontSize: "16px" /* Prevents iOS zoom */ }}
                            />
                          </div>
                          <div className="space-y-2 flex-1 flex flex-col">
                            <label className="text-[13px] font-semibold text-secondary-fg px-1">Message</label>
                            <textarea
                              ref={textareaRef}
                              maxLength={1000}
                              placeholder={type === "bug" ? "Please describe what happened, what you expected, and how to reproduce it..." : "Tell us what's on your mind..."}
                              value={message}
                              onChange={(e) => setMessage(e.target.value)}
                              className="w-full flex-1 min-h-[160px] rounded-2xl border border-black/[0.08] dark:border-white/[0.09] bg-black/[0.03] dark:bg-white/[0.03] p-4 text-[15px] font-medium text-foreground outline-none resize-none focus:border-primary/50 focus:bg-primary/[0.02] transition-colors placeholder:text-foreground/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
                              style={{ fontSize: "16px" /* Prevents iOS zoom */ }}
                            />
                            <div className="flex justify-end pt-1 px-1">
                              <span className="text-[12px] text-secondary-fg/50 tabular-nums font-medium">
                                {message.length} / 1000
                              </span>
                            </div>
                          </div>

                          <div className="pt-2">
                            <button
                              type="button"
                              disabled={!isFormValid || sending}
                              onClick={handleSubmit}
                              className={[
                                "w-full flex items-center justify-center gap-2 h-[52px] rounded-2xl text-[15px] font-semibold transition-all duration-300",
                                isFormValid
                                  ? "bg-primary text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.6)] pressable"
                                  : "bg-foreground/[0.04] border border-black/5 dark:border-white/5 text-foreground/35 cursor-not-allowed",
                              ].join(" ")}
                            >
                              {sending ? (
                                <>
                                  <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                                  Sending...
                                </>
                              ) : (
                                <>
                                  <Send className="h-4 w-4" />
                                  Send message
                                </>
                              )}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
