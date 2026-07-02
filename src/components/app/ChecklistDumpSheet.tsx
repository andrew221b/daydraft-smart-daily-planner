/**
 * Checklist "Add tasks" — the same AI dump-and-split flow the timeline
 * composer offers, scoped to checklist items. Type or paste a wall of ideas,
 * pick which list they land in, and confirm a clean batch of items in one go.
 *
 * Deliberately thinner than the timeline's BulkInputStep/review pair: checklist
 * items don't carry a time or duration, so there's no clarification quiz and no
 * per-row time picker — just title text in, title text (editable) out.
 */
import { memo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, X, ListChecks, Folder, Check, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { haptics } from "@/lib/haptics";
import { checklistTintVars, checklistCategoryTint, type ChecklistTint } from "@/lib/checklistColors";
import type { ChecklistGroup } from "@/hooks/useChecklist";
import { VoiceMicButton } from "@/components/app/VoiceDictation";

type Step = "input" | "review";

// Isolated so typing in the textarea never re-renders the (potentially long)
// review list below it — mirrors the timeline composer's BulkInputStep pattern.
const DumpInputStep = memo(function DumpInputStep({
  initialValue,
  groupNames,
  onContinue,
  loading,
}: {
  initialValue: string;
  /** Existing list names — biases voice recognition toward them (iOS only). */
  groupNames: string[];
  onContinue: (text: string) => void;
  loading: boolean;
}) {
  const [val, setVal] = useState(initialValue);
  // Snapshot of `val` the instant a dictation session starts — onText always
  // reports the FULL session transcript, so each update replaces everything
  // typed/dictated after that snapshot rather than appending duplicates.
  const dictationBaseRef = useRef("");
  return (
    // The Continue button lives in its own shrink-0 footer, OUTSIDE the
    // overflow-y-auto region below — a button's glow/hover shadow paints
    // past its own box, and a scroll container with no room to spare clips
    // that glow into a hard, ugly edge right at the button's border. Only
    // the help text + textarea (the part that can actually get tall) scrolls;
    // min-h-0 on both flex levels is required or the inner scroll area won't
    // actually bound its height and just grows instead of scrolling.
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pb-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] leading-relaxed text-secondary-fg flex-1">
            Type or paste your to-dos — one per line, bullets, commas, anything. We'll split them into checklist items.
          </p>
          {val.length > 0 && (
            <button
              type="button"
              onClick={() => { haptics.tap(); setVal(""); }}
              className="shrink-0 text-[12px] font-medium text-secondary-fg/65 hover:text-destructive pressable"
            >
              Clear
            </button>
          )}
        </div>
        <div className="relative">
          <Textarea
            autoFocus={false}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={"Buy milk, eggs, bread\nCall the dentist\nReturn library books"}
            className="min-h-[150px] rounded-2xl border-soft bg-card text-[14px] pb-11"
            style={{ fontSize: 16 }}
          />
          <VoiceMicButton
            className="absolute bottom-2 right-2"
            contextualStrings={groupNames}
            onSessionStart={() => { dictationBaseRef.current = val; }}
            onText={(text) => {
              const base = dictationBaseRef.current;
              setVal(base ? `${base}${base.endsWith("\n") ? "" : "\n"}${text}` : text);
            }}
          />
        </div>
      </div>
      <div className="shrink-0 pt-3 pb-4">
        <Button
          onClick={() => onContinue(val)}
          disabled={loading || !val.trim()}
          className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/92 text-white font-semibold pressable"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading your to-dos…
            </span>
          ) : "Continue"}
        </Button>
      </div>
    </div>
  );
});

export interface ChecklistDumpRow {
  id: string;
  title: string;
}

export const ChecklistDumpSheet = ({
  open,
  onOpenChange,
  groups,
  tintOf,
  isPro,
  parseDump,
  onConfirm,
  onCreateGroup,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groups: ChecklistGroup[];
  tintOf: (groupId: string) => ChecklistTint;
  /** Pro gates the AI split, matching the timeline composer's entitlement rule. */
  isPro: boolean;
  /** Returns clean item titles from raw dump text — AI (Pro) or local split (free)/fallback. */
  parseDump: (raw: string) => Promise<string[]>;
  /** Commits the final (possibly edited) titles into one target list. null = no category. */
  onConfirm: (titles: string[], groupId: string | null) => void;
  /** Create a new list from the picker and return its id (or null if it failed). */
  onCreateGroup: (name: string) => string | null;
}) => {
  const [step, setStep] = useState<Step>("input");
  const [draft, setDraft] = useState("");
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ChecklistDumpRow[]>([]);
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const reset = () => {
    setStep("input");
    setDraft("");
    setRows([]);
    setTargetGroupId(null);
    setCreatingGroup(false);
    setNewGroupName("");
  };

  const handleContinue = async (text: string) => {
    if (!text.trim()) return;
    setDraft(text);
    setParsing(true);
    try {
      const titles = await parseDump(text);
      if (!titles.length) {
        haptics.notify("error");
        toast("No to-dos found — try rephrasing or add line breaks.");
        setParsing(false);
        return;
      }
      setRows(titles.map((title, i) => ({ id: `${Date.now()}-${i}`, title })));
      setStep("review");
    } finally {
      setParsing(false);
    }
  };

  const submitNewGroup = () => {
    const name = newGroupName.trim();
    if (!name) { setCreatingGroup(false); return; }
    const id = onCreateGroup(name);
    if (id) setTargetGroupId(id); // the new pill renders next tick from updated `groups`
    setNewGroupName("");
    setCreatingGroup(false);
  };

  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));
  const editRow = (id: string, title: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, title } : r)));

  const confirm = () => {
    const titles = rows.map((r) => r.title.trim()).filter(Boolean);
    if (!titles.length) return;
    haptics.impact();
    onConfirm(titles, targetGroupId);
    reset(); // always reset so the next open starts on a fresh input step
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-border/75 bg-popover max-h-[92vh] flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="text-left shrink-0">
          <SheetTitle className="flex items-center gap-2 text-[16px]">
            <Sparkles className="h-4 w-4 text-primary" />
            {step === "review" ? "Review to-dos" : "Add tasks"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Dump a list of to-dos and split them into checklist items.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex-1 flex flex-col min-h-0">
          {step === "input" ? (
            <DumpInputStep
              initialValue={draft}
              groupNames={groups.map((g) => g.title)}
              onContinue={(t) => void handleContinue(t)}
              loading={parsing}
            />
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-2">
              {/* Target list picker — pills, mirrors the category chips used
                  elsewhere in the checklist (tintOf keeps colours consistent). */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-secondary-fg/55 mb-2 px-0.5">
                  Add to
                </p>
                <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 px-1 scrollbar-none">
                  <button
                    type="button"
                    onClick={() => { haptics.selection(); setTargetGroupId(null); }}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium border pressable transition-colors ${
                      targetGroupId === null
                        ? "bg-accent/12 border-accent/40 text-accent"
                        : "bg-card/50 border-border/70 text-secondary-fg hover:text-foreground"
                    }`}
                    style={targetGroupId === null ? checklistTintVars(checklistCategoryTint("ungrouped")) : undefined}
                  >
                    {targetGroupId === null && <Check className="h-3 w-3" />}
                    <ListChecks className="h-3 w-3" />
                    No category
                  </button>
                  {groups.map((g) => {
                    const active = targetGroupId === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => { haptics.selection(); setTargetGroupId(g.id); }}
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium border pressable transition-colors ${
                          active ? "bg-accent/12 border-accent/40 text-accent" : "bg-card/50 border-border/70 text-secondary-fg hover:text-foreground"
                        }`}
                        style={active ? checklistTintVars(tintOf(g.id)) : undefined}
                      >
                        {active && <Check className="h-3 w-3" />}
                        <Folder className="h-3 w-3" />
                        {g.title}
                      </button>
                    );
                  })}
                  {/* Make a new list right here, without leaving the flow. */}
                  <button
                    type="button"
                    onClick={() => { haptics.tap(); setCreatingGroup(true); }}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium border border-dashed border-accent/45 text-accent pressable transition-colors hover:bg-accent/[0.07]"
                  >
                    <FolderPlus className="h-3 w-3" />
                    New list
                  </button>
                </div>

                {creatingGroup && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-soft bg-card px-3 py-2">
                    <FolderPlus className="h-4 w-4 text-accent shrink-0" />
                    <input
                      autoFocus
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNewGroup();
                        if (e.key === "Escape") { setNewGroupName(""); setCreatingGroup(false); }
                      }}
                      placeholder="List name (e.g. Groceries)"
                      className="flex-1 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-secondary-fg/45"
                      style={{ fontSize: 16 }}
                    />
                    <button
                      type="button"
                      onClick={submitNewGroup}
                      disabled={!newGroupName.trim()}
                      className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full text-accent disabled:opacity-40 pressable"
                      aria-label="Create list"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Extracted rows — editable title, removable. */}
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-xl border border-soft bg-card px-3 py-2">
                    <input
                      value={r.title}
                      onChange={(e) => editRow(r.id, e.target.value)}
                      className="flex-1 min-w-0 bg-transparent text-[14px] outline-none"
                      style={{ fontSize: 16 }}
                    />
                    <button
                      type="button"
                      onClick={() => { haptics.tap(); removeRow(r.id); }}
                      className="shrink-0 h-6 w-6 flex items-center justify-center rounded-full text-secondary-fg/55 hover:text-destructive pressable"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Back/Add footer — shrink-0, OUTSIDE the scroll area above, so the
                "Add N items" glow shadow never gets clipped (same reasoning as
                DumpInputStep's Continue footer). */}
            <div className="shrink-0 flex gap-2 pt-3 pb-4">
              <Button
                variant="outline"
                onClick={() => setStep("input")}
                className="h-12 rounded-2xl border-soft"
              >
                Back
              </Button>
              <Button
                onClick={confirm}
                disabled={rows.length === 0}
                className="flex-1 h-12 rounded-2xl bg-primary hover:bg-primary/92 text-white font-semibold pressable"
              >
                Add {rows.length} item{rows.length === 1 ? "" : "s"}
              </Button>
            </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
