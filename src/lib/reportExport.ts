// jspdf + jspdf-autotable (and their transitive html2canvas dep) total
// ~850KB raw / ~200KB gzipped. Importing them eagerly bloats the Reports
// chunk for everyone — including users who never tap "Export PDF".
// They're loaded lazily inside `downloadReportPdf` instead.
import type { jsPDF as JsPdfType, jsPDFOptions } from "jspdf";
import { getErrorMessage } from "@/lib/errors";

export type ReportCategoryRow = {
  name: string;
  color: string;
  seconds: number;
  pct: number;
  currency?: string | null;
  hourlyRate?: number | null;
  earnings?: number;
};

export type ReportEntryRow = {
  date: string;
  startedAt: string;
  endedAt: string;
  category: string;
  /** Title of the task that was tracked (when the session was tied to a block). */
  taskTitle?: string | null;
  durationMin: number;
  currency?: string | null;
  hourlyRate?: number | null;
  earnings?: number;
  note: string | null;
  /** Hand-entered session (typed in after the fact), not a live-timed one. */
  manual?: boolean;
  /** Immutable audit reason recorded when the session's start time was edited. */
  adjustmentReason?: string | null;
};

export type ReportPaymentDetails = {
  currency?: string | null;
  paymentMethod?: string | null;
  displayName?: string | null;
  bankName?: string | null;
  iban?: string | null;
  cryptoNetwork?: string | null;
  cryptoWallet?: string | null;
  paymentLink?: string | null;
  notes?: string | null;
};

export type ReportPaymentSection = {
  title: string;
  details: ReportPaymentDetails;
};

export type ReportPayload = {
  periodLabel: string;
  rangeLabel: string;
  scopeLabel?: string;
  totalSeconds: number;
  totalEarnings?: number;
  /** Legacy single block (merged profile + category for single-category exports). */
  paymentDetails?: ReportPaymentDetails | null;
  /** Multiple payment blocks (e.g. multi-category export with different overrides). */
  paymentSections?: ReportPaymentSection[] | null;
  categories: ReportCategoryRow[];
  entries: ReportEntryRow[];
};

const fmtH = (sec: number) => {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
};
const fmtMoney = (amount: number, currency = "USD") => {
  const code = String(currency || "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      // Always show cents so exported totals match the in-app Reports exactly.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
};

/**
 * Save / share a generated file.
 *
 * On the web we click a synthesised `<a download>` link — the standard
 * pattern. On iOS WKWebView (Capacitor) `<a download>` is silently
 * ignored: the user taps Export and *nothing* happens, which is the bug
 * users hit when running the bundled native app. We fall back to the
 * Web Share API there — iOS gets the system share sheet (Save to Files,
 * AirDrop, Mail, …) which actually persists the file.
 *
 * Web Share is tried first when `navigator.canShare({files})` reports
 * support, regardless of platform — that's the most user-friendly path
 * on mobile Safari / Chrome Android too.
 */
export async function triggerDownload(blob: Blob, filename: string, mimeType: string) {
  // 1. Capacitor native — write to the app's cache dir and hand the file
  //    URI to the system share sheet. This unlocks "Save to Files",
  //    AirDrop, Mail, Messages, etc. Web Share inside WKWebView is
  //    unreliable for non-image MIME types (canShare often returns
  //    false), so we bypass it when the native plugins are available.
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
        import("@capacitor/filesystem"),
        import("@capacitor/share"),
      ]);
      // Text files (CSV): read as a plain string and write with Encoding.UTF8 so
      // Capacitor writes the actual characters (including the BOM) to disk.
      // Passing base64 with Encoding.UTF8 would write the base64 string itself —
      // the "one garbled strip" bug.  Binary files (PDF): no encoding = Capacitor
      // expects base64 and decodes before writing.
      let fileData: string;
      let fileEncoding: typeof Encoding.UTF8 | undefined;
      if (mimeType.startsWith("text/")) {
        fileData = await blob.text();
        fileEncoding = Encoding.UTF8;
      } else {
        fileData = await blobToBase64(blob);
        fileEncoding = undefined;
      }
      const writeRes = await Filesystem.writeFile({
        path: filename,
        data: fileData,
        directory: Directory.Cache,
        encoding: fileEncoding,
        recursive: true,
      });
      try {
        await Share.share({
          title: filename,
          url: writeRes.uri,
          dialogTitle: "Share or save",
        });
      } catch (err) {
        // User dismissed the share sheet — not a failure. Capacitor's Share
        // plugin throws a plain object {message, errorMessage} (NOT an Error
        // instance) when the user cancels; getErrorMessage handles both shapes.
        const msg = getErrorMessage(err);
        if (/cancel/i.test(msg)) return;
        throw err;
      }
      return;
    }
  } catch (e) {
    // Fall through to web paths if the native plugin path fails for any reason.
    console.warn("[triggerDownload] native share failed, falling back", e);
  }

  // 2. Web Share API — covers mobile Safari, Chrome Android, and any
  //    desktop browser that supports file sharing.
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && typeof nav.share === "function" && typeof nav.canShare === "function") {
    try {
      const file = new File([blob], filename, { type: mimeType });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file] });
        return;
      }
    } catch (err) {
      // AbortError means the user dismissed the share sheet — treat as
      // success (their explicit choice), don't fall through to the
      // anchor click which would re-trigger the export.
      if (err instanceof Error && err.name === "AbortError") return;
      // Anything else: fall through to the `<a download>` path below.
    }
  }

  // 3. Anchor click — last resort for plain desktop browsers.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Convert a Blob to a base64 string, stripping the `data:…;base64,` prefix
 *  that FileReader prepends. The Filesystem plugin expects the bare base64
 *  payload. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
}

const fileSafe = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const filenameBase = (report: ReportPayload) => {
  const scope = report.scopeLabel ? `-${fileSafe(report.scopeLabel)}` : "";
  return `time-report-${report.periodLabel.toLowerCase()}${scope}-${new Date().toISOString().slice(0, 10)}`;
};

export const paymentDetailRows = (details?: ReportPaymentDetails | null) => {
  if (!details) return [];
  return [
    ["Currency", details.currency],
    ["Payment method", details.paymentMethod],
    ["Payee", details.displayName],
    ["Bank", details.bankName],
    ["IBAN", details.iban],
    ["Crypto network", details.cryptoNetwork],
    ["Crypto wallet", details.cryptoWallet],
    ["Payment link", details.paymentLink],
    ["Notes", details.notes],
  ].filter((row): row is [string, string] => !!row[1]?.trim());
};

export async function downloadReportCsv(report: ReportPayload) {
  // A spreadsheet-friendly export. Three things make the difference between a
  // clean table and the "everything in one garbled column" mess:
  //   1. UTF-8 BOM so Excel/Numbers detect the encoding (Cyrillic → real text,
  //      not mojibake).
  //   2. A delimiter that matches the user's locale. In en/US the list
  //      separator is "," ; in ru/uk/most of Europe Excel expects ";" and a
  //      plain comma file collapses into a single column. We pick by locale and
  //      switch the decimal mark to match (";" ⇒ decimal comma) so numbers stay
  //      numeric, not text.
  //   3. CRLF rows + every text field quoted + tidy, titled sections.
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  // Locales whose spreadsheets default to ";" as the list separator.
  const semicolonLocale =
    /^(ru|uk|be|de|fr|es|it|pl|pt|nl|cs|sk|sv|sl|hu|ro|tr|el|bg|hr|et|lv|lt|fi|da|nb|nn|no|ka|hy|az|sr|mk)/.test(lang);
  const D = semicolonLocale ? ";" : ",";
  const decSep = semicolonLocale ? "," : ".";
  const EOL = "\r\n";

  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = (n: number, digits = 2) => n.toFixed(digits).replace(".", decSep);
  const lines: string[] = [];
  const push = (...cells: string[]) => lines.push(cells.join(D));
  const blank = () => lines.push("");

  const globalCurrency = report.categories[0]?.currency || report.paymentDetails?.currency || "USD";

  // ── Summary ──
  push(q("DayDraft — Time report"));
  push(q("Report type"), q(report.periodLabel));
  push(q("Date range"), q(report.rangeLabel));
  if (report.scopeLabel) push(q("Categories"), q(report.scopeLabel));
  push(q("Total tracked (h)"), num(report.totalSeconds / 3600));
  push(q("Total earned"), num(report.totalEarnings || 0));
  push(q("Currency"), q(globalCurrency));

  // ── Payment details ──
  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];
  for (const sec of sections) {
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    blank();
    const scope = sec.title.replace(/^Payment\s*—\s*/i, "").trim();
    push(q(scope && scope.toLowerCase() !== "all categories" ? `PAYMENT DETAILS — ${scope}` : "PAYMENT DETAILS"));
    push(q("Field"), q("Value"));
    for (const [label, value] of paymentRows) push(q(label), q(value));
  }

  // ── Category breakdown ──
  if (report.categories.length) {
    blank();
    push(q("CATEGORY BREAKDOWN"));
    push(q("Category"), q("Duration (h)"), q("Share %"), q("Rate/h"), q("Earned"), q("Currency"));
    for (const c of report.categories) {
      push(
        q(c.name),
        num(c.seconds / 3600),
        num(c.pct * 100, 1),
        c.hourlyRate != null ? num(c.hourlyRate) : "",
        num(c.earnings || 0),
        q(c.currency || "USD"),
      );
    }
  }

  // ── Activity log — one flat table, rows grouped by category order ──
  if (report.entries.length) {
    blank();
    push(q("ACTIVITY LOG"));
    push(
      q("Date"), q("Start"), q("End"), q("Category"), q("Session"), q("Note"),
      q("Duration (min)"), q("Duration (h)"), q("Rate/h"), q("Earned"), q("Currency"),
      q("Manual"), q("Adjustment reason"),
    );
    // Sort by the breakdown's category order (Uncategorized last) so rows read
    // grouped, while staying a single flat table the user can re-sort/filter.
    const order = new Map<string, number>();
    report.categories.forEach((c, i) => order.set(c.name, i));
    const rank = (cat: string) => (cat === "Uncategorized" ? Infinity : order.get(cat) ?? 1e6);
    const sorted = [...report.entries].sort((a, b) => rank(a.category) - rank(b.category));
    for (const e of sorted) {
      push(
        q(e.date),
        q(e.startedAt),
        q(e.endedAt),
        q(e.category),
        q(e.taskTitle ?? ""),
        q(e.note ?? ""),
        String(e.durationMin),
        num(e.durationMin / 60),
        e.hourlyRate != null ? num(e.hourlyRate) : "",
        num(e.earnings || 0),
        q(e.currency || "USD"),
        q(e.manual ? "yes" : ""),
        q(e.adjustmentReason ?? ""),
      );
    }
  }

  // UTF-8 BOM up front so spreadsheet apps don't mis-detect the encoding.
  const csv = "﻿" + lines.join(EOL) + EOL;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  await triggerDownload(blob, `${filenameBase(report)}.csv`, "text/csv");
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  if (h.length === 6) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [120, 120, 120];
}

type RGB = [number, number, number];

// ── Font embedding (Unicode-safe) ─────────────────────────────
// jsPDF's built-in helvetica is WinAnsi-only; Cyrillic, Greek, anything
// outside Latin-1 renders as gibberish ("? ? ? > 3 > B >"). To produce a
// report that actually reads in Russian/Ukrainian/etc. we embed Inter
// (Apache 2.0 via Google Fonts) as a TTF and register it as the active
// font for every text operation.
//
// The TTFs live in `public/fonts/` and are fetched lazily on first PDF
// export, then cached in-memory for the rest of the session. ~325KB per
// face — only paid by users who actually export PDFs.
const FONT_FAMILY = "Inter";
let cachedFonts: { regular: string; bold: string } | null = null;
let cachedFontPromise: Promise<{ regular: string; bold: string } | null> | null = null;

async function loadInterFonts(): Promise<{ regular: string; bold: string } | null> {
  if (cachedFonts) return cachedFonts;
  if (cachedFontPromise) return cachedFontPromise;
  cachedFontPromise = (async () => {
    try {
      const [regResp, boldResp] = await Promise.all([
        fetch("/fonts/Inter-Regular.ttf"),
        fetch("/fonts/Inter-Bold.ttf"),
      ]);
      if (!regResp.ok || !boldResp.ok) throw new Error("Font HTTP error");
      const [regBuf, boldBuf] = await Promise.all([regResp.arrayBuffer(), boldResp.arrayBuffer()]);
      const toBase64 = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
        }
        return btoa(bin);
      };
      cachedFonts = { regular: toBase64(regBuf), bold: toBase64(boldBuf) };
      return cachedFonts;
    } catch (e) {
      console.warn("[reportExport] Inter fetch failed — falling back to helvetica", e);
      return null;
    } finally {
      cachedFontPromise = null;
    }
  })();
  return cachedFontPromise;
}

function registerFonts(doc: JsPdfType, fonts: { regular: string; bold: string } | null): string {
  if (!fonts) return "helvetica";
  try {
    doc.addFileToVFS("Inter-Regular.ttf", fonts.regular);
    doc.addFont("Inter-Regular.ttf", FONT_FAMILY, "normal");
    doc.addFileToVFS("Inter-Bold.ttf", fonts.bold);
    doc.addFont("Inter-Bold.ttf", FONT_FAMILY, "bold");
    return FONT_FAMILY;
  } catch (e) {
    console.warn("[reportExport] Font registration failed — falling back to helvetica", e);
    return "helvetica";
  }
}

export async function downloadReportPdf(report: ReportPayload) {
  // Lazy-load the heavyweight PDF deps. Vite splits these into a
  // separate chunk that only ships when the user actually exports.
  const [{ default: jsPDF }, { default: autoTable }, fonts] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadInterFonts(),
  ]);
  const doc: JsPdfType = new jsPDF({ unit: "pt", format: "a4" } as jsPDFOptions);
  const FONT = registerFonts(doc, fonts);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;

  // ── Palette ───────────────────────────────────────────────
  // Editorial light theme. Single accent (indigo) + emerald for money.
  // Everything else lives on a tight neutral ramp so totals + numbers do
  // the visual heavy lifting.
  const ink: RGB         = [12, 14, 20];     // darker, richer charcoal
  const body: RGB        = [50, 55, 70];     // body copy
  const sub: RGB         = [115, 120, 138];  // labels, captions
  const faint: RGB       = [180, 184, 200];  // page-number, hairlines
  const hairline: RGB    = [235, 238, 245];  // softer row separators
  const soft: RGB        = [248, 250, 254];  // premium alternating rows tint
  const cardFill: RGB    = [246, 248, 253];  // soft filled cards
  const accent: RGB      = [99, 102, 241];   // indigo-500
  const accentSoft: RGB  = [139, 92, 246];   // violet-500 (second card)
  const success: RGB     = [16, 185, 129];   // emerald-500 (earnings)
  const amber: RGB       = [217, 119, 6];    // amber-600 (hand-entered / adjusted)
  const white: RGB       = [255, 255, 255];

  const usableW = pageW - margin * 2;

  // ── Helpers ───────────────────────────────────────────────
  const sectionTitle = (text: string, y: number) => {
    doc.setFont(FONT, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...sub);
    doc.text(text.toUpperCase(), margin, y, { charSpace: 2 });
    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 8, pageW - margin, y + 8);
  };

  const ensureRoom = (cursorY: number, need: number): number => {
    if (cursorY + need <= pageH - 64) return cursorY;
    doc.addPage();
    return margin + 12;
  };

  // ── Header band ───────────────────────────────────────────
  // Solid dark block, indigo hairline underneath, brand badge top-left,
  // period title large, range smaller below. Right rail carries the
  // generation date + scope label as quiet metadata.
  doc.setFillColor(...ink);
  doc.rect(0, 0, pageW, 144, "F");
  doc.setFillColor(...accent);
  doc.rect(0, 144, pageW, 2, "F");

  // Brand badge — rounded mark + wordmark, mimics the app icon.
  const markX = margin;
  const markY = 36;
  doc.setFillColor(...accent);
  doc.roundedRect(markX, markY, 22, 22, 6, 6, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(markX + 11, markY + 11, 3.8, "F");

  doc.setFont(FONT, "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(...white);
  doc.text("DayDraft", markX + 32, markY + 9);
  doc.setFont(FONT, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(180, 184, 210);
  doc.text("TIME REPORT", markX + 32, markY + 21, { charSpace: 2 });

  // Period (large) + range (small) — left-aligned hero text.
  doc.setFont(FONT, "bold");
  doc.setFontSize(30);
  doc.setTextColor(...white);
  doc.text(report.periodLabel, margin, 104);

  doc.setFont(FONT, "normal");
  doc.setFontSize(11);
  doc.setTextColor(190, 193, 215);
  doc.text(report.rangeLabel, margin, 124);

  // Right-rail meta — generation date + scope (if set).
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  doc.setFont(FONT, "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(170, 174, 200);
  doc.text(`Generated ${generated}`, pageW - margin, 40, { align: "right" });
  if (report.scopeLabel) {
    doc.setFont(FONT, "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...white);
    doc.text(report.scopeLabel, pageW - margin, 56, { align: "right" });
  }

  // ── Stat cards ────────────────────────────────────────────
  // Outlined cards instead of solid fills — calmer, lets the typography
  // be the focal point. Coloured accent strip on the left edge keys each
  // card to its semantic role (time / sessions / earnings).
  const cardsY = 176;
  const cardH = 96;
  const gap = 14;
  const hasEarnings = (report.totalEarnings || 0) > 0;
  const sessionCount = report.entries.length;
  const cardCount = hasEarnings ? 3 : 2;
  const cardW = (usableW - gap * (cardCount - 1)) / cardCount;

  const drawCard = (x: number, label: string, value: string, dot: RGB) => {
    // Card body — soft fill without border for premium clean look
    doc.setFillColor(...cardFill);
    doc.roundedRect(x, cardsY, cardW, cardH, 14, 14, "F");
    // Accent strip on the left edge — 3pt wide, full height.
    doc.setFillColor(...dot);
    doc.roundedRect(x, cardsY, 3, cardH, 1.5, 1.5, "F");
    // Label
    doc.setFont(FONT, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...sub);
    doc.text(label.toUpperCase(), x + 22, cardsY + 30, { charSpace: 1.8 });
    // Value — autoscale a touch for long monetary strings (CA$1,234.56).
    const targetMaxW = cardW - 44;
    let valueSize = 28;
    doc.setFont(FONT, "bold");
    doc.setFontSize(valueSize);
    while (valueSize > 16 && doc.getTextWidth(value) > targetMaxW) {
      valueSize -= 1.5;
      doc.setFontSize(valueSize);
    }
    doc.setTextColor(...ink);
    doc.text(value, x + 22, cardsY + 72);
  };

  let xCursor = margin;
  drawCard(xCursor, "Total tracked", fmtH(report.totalSeconds), accent);
  xCursor += cardW + gap;
  drawCard(xCursor, "Sessions", String(sessionCount), accentSoft);
  xCursor += cardW + gap;
  if (hasEarnings) {
    const currency = report.categories[0]?.currency || report.paymentDetails?.currency || "USD";
    drawCard(xCursor, "Estimated earned", fmtMoney(report.totalEarnings || 0, currency), success);
  }

  let cursorY = cardsY + cardH + 34;

  // ── Time distribution: stacked bar + legend ──────────────
  // The bar visualises pct-of-total; the legend below is a uniform grid
  // (rather than a flowing chip strip) so labels don't collide with each
  // other when category names are long.
  if (report.categories.length > 0 && report.totalSeconds > 0) {
    cursorY = ensureRoom(cursorY, 130);
    sectionTitle("Time distribution", cursorY);
    cursorY += 22;

    const barH = 12;
    // Bar background — slightly inset rounded rect.
    doc.setFillColor(...soft);
    doc.roundedRect(margin, cursorY, usableW, barH, 6, 6, "F");
    // Segments left → right.
    let segX = margin;
    for (const c of report.categories) {
      const segW = c.pct * usableW;
      if (segW < 1) continue;
      const [r, g, b] = hexToRgb(c.color || "#6366f1");
      doc.setFillColor(r, g, b);
      doc.rect(segX, cursorY, segW, barH, "F");
      
      // Draw white gap (1.5pt) to the left of the segment, unless it's the very first pixel
      if (segX > margin + 1) {
        doc.setFillColor(255, 255, 255);
        doc.rect(segX - 0.75, cursorY, 1.5, barH, "F");
      }
      segX += segW;
    }
    
    // White overlay frame to "clip" the overflowing segment corners back to the pill shape.
    // We draw a thick white rounded rectangle stroke OVER the outer edge.
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(3);
    doc.roundedRect(margin - 1.5, cursorY - 1.5, usableW + 3, barH + 3, 7.5, 7.5, "S");
    
    cursorY += barH + 20;

    // Legend grid — 3 columns on A4, wraps to additional rows. Each cell
    // gets a fixed width so long names truncate cleanly with an ellipsis
    // instead of running into neighbouring chips.
    doc.setFont(FONT, "normal");
    doc.setFontSize(9.5);
    const legendCols = 3;
    const legendGap = 16;
    const legendColW = (usableW - legendGap * (legendCols - 1)) / legendCols;
    const legendRowH = 18;
    const visible = report.categories.filter((c) => c.pct >= 0.005 || c.seconds > 0);
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const col = i % legendCols;
      const row = Math.floor(i / legendCols);
      const cellX = margin + col * (legendColW + legendGap);
      const cellY = cursorY + row * legendRowH;
      const [r, g, b] = hexToRgb(c.color || "#6366f1");
      doc.setFillColor(r, g, b);
      doc.circle(cellX + 4, cellY + 4, 3.4, "F");
      // Truncate long names so the percent stays anchored to the right.
      const pctText = `${(c.pct * 100).toFixed(0)}%`;
      doc.setFont(FONT, "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...sub);
      const pctW = doc.getTextWidth(pctText);
      doc.setFont(FONT, "normal");
      doc.setTextColor(...body);
      const nameMaxW = legendColW - 14 - pctW - 8;
      let name = c.name;
      while (doc.getTextWidth(name) > nameMaxW && name.length > 1) {
        name = name.slice(0, -1);
      }
      if (name.length < c.name.length) name = name.slice(0, Math.max(1, name.length - 1)) + "…";
      doc.text(name, cellX + 13, cellY + 7);
      doc.setFont(FONT, "bold");
      doc.setTextColor(...sub);
      doc.text(pctText, cellX + legendColW, cellY + 7, { align: "right" });
    }
    cursorY += Math.ceil(visible.length / legendCols) * legendRowH + 16;
  }

  // ── Payment details ──────────────────────────────────────
  // Per-section header carries the category scope inline (no shouty
  // "PAYMENT — Work" eyebrow that broke layout on Cyrillic before).
  // Rows are quiet key/value pairs in a soft card; sub-eyebrow shows
  // which categories this block applies to when there's more than one.
  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];

  // Emphasised block: an accent banner header, a tinted body, an accent strip
  // down the left edge, and the payment-method value called out in accent +
  // underline — so the "how do I get paid" details are the first thing the eye
  // lands on (this is the part an invoice recipient actually needs).
  const payTint: RGB = [243, 244, 255];      // very light indigo body fill
  const payTintAlt: RGB = [235, 236, 252];   // alternating row
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    cursorY = ensureRoom(cursorY, 120);

    // Scope label (strip the "Payment — " prefix the caller adds). Folded into
    // the accent banner so long / Cyrillic names never collapse the layout.
    const scopeLabel = sec.title.replace(/^Payment\s*—\s*/i, "").trim();
    const showScope = !!scopeLabel && scopeLabel.toLowerCase() !== "all categories";
    const bannerText =
      sections.length === 1
        ? showScope ? `Payment details · ${scopeLabel}` : "Payment details"
        : `Payment details · ${showScope ? scopeLabel : `${si + 1} of ${sections.length}`}`;

    // Which row is the payment method — gets the accent + underline treatment.
    const methodIdx = paymentRows.findIndex(([label]) => /payment method/i.test(label));

    autoTable(doc, {
      startY: cursorY,
      head: [[{ content: bannerText, colSpan: 2 }]],
      body: paymentRows,
      margin: { left: margin, right: margin },
      tableWidth: usableW,
      styles: {
        font: FONT,
        fontSize: 9.5,
        cellPadding: { top: 11, bottom: 11, left: 18, right: 14 },
        textColor: body,
        lineColor: white,
        lineWidth: 0,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: accent,
        textColor: white,
        fontStyle: "bold",
        fontSize: 10.5,
        cellPadding: { top: 10, bottom: 10, left: 18, right: 14 },
        lineWidth: 0,
      },
      columnStyles: {
        0: { fontStyle: "bold", textColor: sub, cellWidth: 150 },
        1: { fontStyle: "bold", textColor: ink },
      },
      bodyStyles: { fillColor: payTint },
      alternateRowStyles: { fillColor: payTintAlt },
      theme: "plain",
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 1 && data.row.index === methodIdx) {
          data.cell.styles.textColor = accent;
        }
      },
      didDrawCell: (data) => {
        // Accent strip down the left edge of the body (keys the whole block).
        if (data.section === "body" && data.column.index === 0) {
          doc.setFillColor(...accent);
          doc.rect(margin, data.cell.y, 3, data.cell.height, "F");
        }
        // Underline the payment-method value to make it pop.
        if (data.section === "body" && data.column.index === 1 && data.row.index === methodIdx) {
          const v = String(paymentRows[methodIdx]?.[1] ?? "");
          if (v) {
            doc.setFont(FONT, "bold");
            doc.setFontSize(9.5);
            const ux = data.cell.x + 18;
            const uy = data.cell.y + data.cell.height / 2 + 5.5;
            doc.setDrawColor(...accent);
            doc.setLineWidth(0.8);
            doc.line(ux, uy, ux + doc.getTextWidth(v), uy);
          }
        }
      },
    });
    cursorY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY) + 24;
  }

  // ── Column-sizing helpers ────────────────────────────────
  // Measure the widest string in a set at a given size/weight so the money /
  // date / time columns are sized to their actual data and never clip. Both
  // tables use overflow:"ellipsize" (never linebreak), so the only thing that
  // can shorten is a flex text column — numbers and dates always fit on one line.
  const headFill: RGB = [243, 245, 251];
  const measureMax = (values: string[], size: number, bold = false): number => {
    doc.setFont(FONT, bold ? "bold" : "normal");
    doc.setFontSize(size);
    let w = 0;
    for (const v of values) { const t = doc.getTextWidth(v || ""); if (t > w) w = t; }
    return w;
  };
  const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const getFinalY = () => (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY;

  // ── Category breakdown ───────────────────────────────────
  // Numeric columns auto-size from the data (+ a small buffer) so "Share" never
  // collapses to "100…." and rate/earned of any currency magnitude stay on one
  // line; the Category column flexes into whatever space is left.
  if (report.categories.length) {
    cursorY = ensureRoom(cursorY, 110);
    sectionTitle("Category breakdown", cursorY);
    cursorY += 14;

    const FS = 9.5;
    const PAD = 9;
    const BUF = PAD * 2 + 3;
    const fmtPct = (p: number) => {
      const v = p * 100;
      if (v >= 99.95) return "100%";
      return v < 9.95 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
    };
    const cb = report.categories.map((c) => ({
      time: fmtH(c.seconds),
      share: fmtPct(c.pct),
      rate: c.hourlyRate ? `${fmtMoney(c.hourlyRate, c.currency || "USD")}/h` : "—",
      earned: c.earnings && c.earnings > 0 ? fmtMoney(c.earnings, c.currency || "USD") : "—",
    }));
    const dotW = 18;
    const timeW = clampN(measureMax([...cb.map((r) => r.time), "Time"], FS, true) + BUF, 50, 84);
    const shareW = clampN(measureMax([...cb.map((r) => r.share), "Share"], FS) + BUF, 44, 64);
    const rateW = clampN(measureMax([...cb.map((r) => r.rate), "Rate/hr"], FS) + BUF, 54, 110);
    const earnedW = clampN(measureMax([...cb.map((r) => r.earned), "Earned"], FS, true) + BUF, 58, 120);
    const nameW = usableW - dotW - timeW - shareW - rateW - earnedW;

    autoTable(doc, {
      startY: cursorY,
      head: [["", "Category", "Time", "Share", "Rate/h", "Earned"]],
      body: report.categories.map((c, i) => ["", c.name, cb[i].time, cb[i].share, cb[i].rate, cb[i].earned]),
      margin: { left: margin, right: margin },
      tableWidth: usableW,
      styles: {
        font: FONT,
        fontSize: FS,
        cellPadding: { top: 9, bottom: 9, left: PAD, right: PAD },
        textColor: ink,
        lineColor: hairline,
        lineWidth: 0,
        valign: "middle",
        overflow: "ellipsize",
      },
      headStyles: {
        fillColor: headFill,
        textColor: sub,
        fontStyle: "bold",
        fontSize: FS,
        cellPadding: { top: 8, bottom: 9, left: PAD, right: PAD },
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: soft },
      columnStyles: {
        0: { cellWidth: dotW, cellPadding: { top: 9, bottom: 9, left: 0, right: 0 } },
        1: { cellWidth: nameW, fontStyle: "bold", textColor: ink },
        2: { cellWidth: timeW, halign: "left", fontStyle: "bold" },
        3: { cellWidth: shareW, halign: "left", textColor: sub },
        4: { cellWidth: rateW, halign: "left", textColor: sub },
        5: { cellWidth: earnedW, halign: "left", fontStyle: "bold" },
      },
      theme: "plain",
      didParseCell: (data) => {
        if (
          data.section === "body" &&
          (data.column.index === 4 || data.column.index === 5) &&
          data.cell.raw === "—"
        ) {
          data.cell.styles.textColor = faint;
          data.cell.styles.fontStyle = "normal";
        }
      },
      didDrawCell: (data) => {
        // Colour dot — centred in the tight first column.
        if (data.section === "body" && data.column.index === 0) {
          const row = report.categories[data.row.index];
          if (row) {
            const [r, g, b] = hexToRgb(row.color || "#6366f1");
            doc.setFillColor(r, g, b);
            doc.circle(data.cell.x + data.cell.width / 2 + 2, data.cell.y + data.cell.height / 2, 3.6, "F");
          }
        }
        // Accent underline beneath the full header row (drawn once).
        if (data.section === "head" && data.column.index === 5) {
          doc.setDrawColor(...accent);
          doc.setLineWidth(1);
          const lineY = data.cell.y + data.cell.height;
          doc.line(margin, lineY, pageW - margin, lineY);
        }
      },
    });
    cursorY = getFinalY() + 26;
  }

  // ── Activity log — grouped by category ───────────────────
  // Sessions are bucketed under their category (a coloured header card), with
  // Uncategorized last. Every group uses the SAME column geometry (widths
  // measured once across ALL rows) so the tables line up down the page. A
  // leading marker column flags hand-entered / time-adjusted / noted sessions
  // with a coloured ref number that points at the "Notes & adjustments" block
  // below — keeping the log itself uncluttered. All columns are left-aligned.
  type NoteRef = { n: number; e: ReportEntryRow; manual: boolean; hasReason: boolean };
  const noteRefs: NoteRef[] = [];
  const flagOf = (e: ReportEntryRow) => {
    const manual = !!e.manual;
    const hasReason = !!(e.adjustmentReason && e.adjustmentReason.trim());
    const hasNote = !!(e.note && e.note.trim());
    return { manual, hasReason, hasNote, flagged: manual || hasReason || hasNote };
  };

  if (report.entries.length) {
    cursorY = ensureRoom(cursorY, 110);
    sectionTitle(
      `Activity log · ${report.entries.length} ${report.entries.length === 1 ? "session" : "sessions"}`,
      cursorY,
    );
    cursorY += 20;

    const FS = 9;
    const PAD = 8;
    const BUF = PAD * 2 + 3;
    const markW = 22;

    const rowOf = (e: ReportEntryRow) => ({
      date: e.date,
      time: `${e.startedAt} – ${e.endedAt}`,
      session: (e.taskTitle && e.taskTitle.trim()) || "—",
      dur: fmtH(e.durationMin * 60),
      earned: e.earnings && e.earnings > 0 ? fmtMoney(e.earnings, e.currency || "USD") : "—",
    });
    const allRows = report.entries.map(rowOf);
    const anyEarned = allRows.some((r) => r.earned !== "—");

    // Global widths — measured across every row so all category tables align.
    const dateW = clampN(measureMax([...allRows.map((r) => r.date), "Date"], FS, true) + BUF, 46, 72);
    const timeW = clampN(measureMax([...allRows.map((r) => r.time), "Time"], FS) + BUF, 70, 120);
    const durW = clampN(measureMax([...allRows.map((r) => r.dur), "Duration"], FS, true) + BUF, 50, 64);
    const earnedW = anyEarned ? clampN(measureMax([...allRows.map((r) => r.earned), "Earned"], FS, true) + BUF, 58, 104) : 0;
    const sessionW = usableW - markW - dateW - timeW - durW - earnedW;

    const cols: { header: string; key: string; width: number; bold?: boolean; color: RGB }[] = [
      { header: "", key: "mark", width: markW, color: sub },
      { header: "Date", key: "date", width: dateW, color: ink, bold: true },
      { header: "Time", key: "time", width: timeW, color: sub },
      { header: "Session", key: "session", width: sessionW, color: ink },
      { header: "Duration", key: "dur", width: durW, color: ink, bold: true },
    ];
    if (anyEarned) cols.push({ header: "Earned", key: "earned", width: earnedW, color: ink, bold: true });
    const sessionColIdx = 3;
    const earnedColIdx = anyEarned ? cols.length - 1 : -1;

    const columnStyles: Record<number, Record<string, unknown>> = {};
    cols.forEach((c, i) => {
      columnStyles[i] = {
        cellWidth: c.width,
        halign: "left",
        fontStyle: c.bold ? "bold" : "normal",
        textColor: c.color,
        ...(c.key === "mark" ? { cellPadding: { top: 7, bottom: 7, left: 0, right: 0 } } : {}),
      };
    });

    // Bucket entries by category, ordered to match the breakdown; Uncat last.
    const byCat = new Map<string, { color: string; items: ReportEntryRow[] }>();
    for (const e of report.entries) {
      const name = e.category || "Uncategorized";
      if (!byCat.has(name)) {
        const fromBreakdown = report.categories.find((c) => c.name === name);
        byCat.set(name, {
          color: fromBreakdown?.color || (name === "Uncategorized" ? "#9aa0b4" : "#6366f1"),
          items: [],
        });
      }
      byCat.get(name)!.items.push(e);
    }
    const orderedNames: string[] = [];
    for (const c of report.categories) if (byCat.has(c.name) && !orderedNames.includes(c.name)) orderedNames.push(c.name);
    for (const name of byCat.keys()) if (!orderedNames.includes(name)) orderedNames.push(name);
    orderedNames.sort((a, b) => (a === "Uncategorized" ? 1 : 0) - (b === "Uncategorized" ? 1 : 0));

    for (const name of orderedNames) {
      const group = byCat.get(name)!;
      const groupSecs = group.items.reduce((s, e) => s + e.durationMin * 60, 0);
      const groupEarned = group.items.reduce((s, e) => s + (e.earnings || 0), 0);
      const groupCur = group.items.find((e) => e.currency)?.currency || "USD";

      // Category header card — colour strip + dot + name (truncated) + stats.
      const headH = 26;
      cursorY = ensureRoom(cursorY, headH + 46);
      doc.setFillColor(...cardFill);
      doc.roundedRect(margin, cursorY, usableW, headH, 7, 7, "F");
      const [cr, cg, cb] = hexToRgb(group.color || "#6366f1");
      doc.setFillColor(cr, cg, cb);
      doc.roundedRect(margin, cursorY, 3, headH, 1.5, 1.5, "F");
      doc.circle(margin + 16, cursorY + headH / 2, 3.6, "F");
      const stats = `${group.items.length} ${group.items.length === 1 ? "session" : "sessions"} · ${fmtH(groupSecs)}${groupEarned > 0 ? ` · ${fmtMoney(groupEarned, groupCur)}` : ""}`;
      doc.setFont(FONT, "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...sub);
      const statsW = doc.getTextWidth(stats);
      doc.text(stats, pageW - margin - 12, cursorY + headH / 2 + 3, { align: "right" });
      // Name — truncated so it never collides with the right-rail stats.
      doc.setFont(FONT, "bold");
      doc.setFontSize(11);
      doc.setTextColor(...ink);
      const nameX = margin + 28;
      const nameMaxW = (pageW - margin - 12 - statsW - 14) - nameX;
      let nm = name;
      while (doc.getTextWidth(nm) > nameMaxW && nm.length > 1) nm = nm.slice(0, -1);
      if (nm.length < name.length) nm = nm.slice(0, Math.max(1, nm.length - 1)) + "…";
      doc.text(nm, nameX, cursorY + headH / 2 + 4);
      cursorY += headH + 6;

      // Assign refs (render order, top→bottom) for flagged rows in this group.
      const refByRowIdx = new Map<number, NoteRef>();
      group.items.forEach((e, idx) => {
        const f = flagOf(e);
        if (f.flagged) {
          const ref: NoteRef = { n: noteRefs.length + 1, e, manual: f.manual, hasReason: f.hasReason };
          noteRefs.push(ref);
          refByRowIdx.set(idx, ref);
        }
      });

      autoTable(doc, {
        startY: cursorY,
        head: [cols.map((c) => c.header)],
        body: group.items.map((e) => {
          const rec: Record<string, string> = { mark: "", ...rowOf(e) };
          return cols.map((c) => rec[c.key]);
        }),
        margin: { left: margin, right: margin, bottom: 56 },
        tableWidth: usableW,
        styles: {
          font: FONT,
          fontSize: FS,
          cellPadding: { top: 7, bottom: 7, left: PAD, right: PAD },
          textColor: body,
          lineColor: hairline,
          lineWidth: 0,
          valign: "middle",
          overflow: "ellipsize",
        },
        headStyles: {
          fillColor: headFill,
          textColor: sub,
          fontStyle: "bold",
          fontSize: FS,
          cellPadding: { top: 6, bottom: 7, left: PAD, right: PAD },
          lineWidth: 0,
        },
        alternateRowStyles: { fillColor: soft },
        columnStyles,
        theme: "plain",
        didParseCell: (data) => {
          if (
            data.section === "body" &&
            data.cell.raw === "—" &&
            (data.column.index === sessionColIdx || data.column.index === earnedColIdx)
          ) {
            data.cell.styles.textColor = faint;
            data.cell.styles.fontStyle = "normal";
          }
        },
        didDrawCell: (data) => {
          // Marker badge — coloured ref number for flagged rows.
          if (data.section === "body" && data.column.index === 0) {
            const ref = refByRowIdx.get(data.row.index);
            if (ref) {
              const mc: RGB = ref.manual || ref.hasReason ? amber : accent;
              const bw = 15, bh = 12;
              const bx = data.cell.x + (data.cell.width - bw) / 2;
              const by = data.cell.y + (data.cell.height - bh) / 2;
              doc.setFillColor(...mc);
              doc.roundedRect(bx, by, bw, bh, 2.5, 2.5, "F");
              doc.setFont(FONT, "bold");
              doc.setFontSize(7.5);
              doc.setTextColor(...white);
              doc.text(String(ref.n), bx + bw / 2, by + bh / 2 + 2.5, { align: "center" });
            }
          }
        },
      });
      cursorY = getFinalY() + 12;
    }

    // ── Notes & adjustments ────────────────────────────────
    // The decluttered detail: each flagged session, by ref number, with its
    // note and/or the audit reason for any manual time change. Amber ref =
    // hand-entered / adjusted, indigo ref = note only.
    if (noteRefs.length) {
      cursorY = ensureRoom(cursorY, 74);
      cursorY += 6;
      sectionTitle("Notes & adjustments", cursorY);
      cursorY += 16;

      const NFS = 9;
      const NPAD = 8;
      const refW = 28;
      const noteBody = noteRefs.map((ref) => {
        const e = ref.e;
        const sess = (e.taskTitle && e.taskTitle.trim()) || "Session";
        const when = `${e.date} · ${e.startedAt}–${e.endedAt}`;
        const lines = [`${sess}  —  ${when}${ref.manual ? "   • Manually added" : ""}`];
        if (e.note && e.note.trim()) lines.push(`Note: ${e.note.trim()}`);
        if (e.adjustmentReason && e.adjustmentReason.trim()) lines.push(`Adjusted: ${e.adjustmentReason.trim()}`);
        return ["", lines.join("\n")];
      });

      autoTable(doc, {
        startY: cursorY,
        body: noteBody,
        margin: { left: margin, right: margin, bottom: 56 },
        tableWidth: usableW,
        styles: {
          font: FONT,
          fontSize: NFS,
          cellPadding: { top: 9, bottom: 9, left: NPAD, right: NPAD },
          textColor: body,
          lineColor: hairline,
          lineWidth: 0,
          valign: "top",
          overflow: "linebreak",
        },
        columnStyles: {
          0: { cellWidth: refW, cellPadding: { top: 9, bottom: 9, left: 0, right: 0 } },
          1: { textColor: body },
        },
        alternateRowStyles: { fillColor: soft },
        theme: "plain",
        didDrawCell: (data) => {
          if (data.section === "body" && data.column.index === 0) {
            const ref = noteRefs[data.row.index];
            if (!ref) return;
            const mc: RGB = ref.manual || ref.hasReason ? amber : accent;
            const bw = 16, bh = 13;
            const bx = data.cell.x + (data.cell.width - bw) / 2 + 1;
            const by = data.cell.y + 9;
            doc.setFillColor(...mc);
            doc.roundedRect(bx, by, bw, bh, 3, 3, "F");
            doc.setFont(FONT, "bold");
            doc.setFontSize(8);
            doc.setTextColor(...white);
            doc.text(String(ref.n), bx + bw / 2, by + bh / 2 + 2.8, { align: "center" });
          }
        },
      });
      cursorY = getFinalY() + 16;
    }
  } else {
    cursorY = ensureRoom(cursorY, 50);
    sectionTitle("Activity log", cursorY);
    cursorY += 28;
    doc.setTextColor(...sub);
    doc.setFont(FONT, "normal");
    doc.setFontSize(10.5);
    doc.text("No tracker entries in this period yet.", margin, cursorY);
  }

  // ── Footer on every page ────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 34, pageW - margin, pageH - 34);

    // Brand mark (small)
    doc.setFillColor(...accent);
    doc.roundedRect(margin, pageH - 24, 10, 10, 2.5, 2.5, "F");
    doc.setFont(FONT, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...sub);
    doc.text("DAYDRAFT", margin + 16, pageH - 16, { charSpace: 1.8 });

    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...faint);
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 16, { align: "right" });
  }

  // `doc.save()` calls the same `<a download>` trick we route around in
  // `triggerDownload` — bypass it so the iOS share sheet path kicks in.
  const pdfBlob = doc.output("blob") as Blob;
  await triggerDownload(pdfBlob, `${filenameBase(report)}.pdf`, "application/pdf");
}