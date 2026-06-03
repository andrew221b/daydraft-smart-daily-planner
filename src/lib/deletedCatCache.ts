const KEY = "dd-deleted-cats";

export type DeletedCatEntry = { name: string; color: string; currency: string };

export function saveDeletedCat(id: string, name: string, color: string, currency: string): void {
  try {
    const map: Record<string, DeletedCatEntry> = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    map[id] = { name, color, currency };
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function getDeletedCat(id: string): DeletedCatEntry | null {
  try {
    const map: Record<string, DeletedCatEntry> = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return map[id] ?? null;
  } catch { return null; }
}
