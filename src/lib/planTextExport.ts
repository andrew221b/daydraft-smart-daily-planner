import type { Block } from "@/lib/daydraft";
import { fmtTime } from "@/lib/daydraft";

function durLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Plain-text outline for clipboard / messages. */
export function formatPlanAsPlainText(opts: { headline?: string; blocks: Block[] }): string {
  const lines: string[] = [];
  if (opts.headline?.trim()) {
    lines.push(opts.headline.trim(), "");
  }
  for (const b of opts.blocks) {
    const t = fmtTime(b.start_time);
    const dur = durLabel(b.duration_min);
    const mark = b.kind === "task" && b.completed ? " ✓" : "";
    lines.push(`${t}  ${dur}  ${b.title}${mark}`);
  }
  return lines.join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
