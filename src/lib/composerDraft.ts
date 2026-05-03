/** Persist planner brain-dump per target day (survives refresh / tab close). */
export const composerDraftKey = (planDate: string) => `dd_composer_${planDate}`;

export function readComposerDraft(planDate: string): string {
  try {
    return localStorage.getItem(composerDraftKey(planDate)) || "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(planDate: string, text: string): void {
  try {
    const k = composerDraftKey(planDate);
    if (!text.trim()) localStorage.removeItem(k);
    else localStorage.setItem(k, text);
  } catch {
    /* quota / private mode */
  }
}

export function clearComposerDraft(planDate: string): void {
  try {
    localStorage.removeItem(composerDraftKey(planDate));
  } catch {
    /* ignore */
  }
}
