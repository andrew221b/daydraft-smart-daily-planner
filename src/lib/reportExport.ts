// jspdf + jspdf-autotable (and their transitive html2canvas dep) total
// ~850KB raw / ~200KB gzipped. Importing them eagerly bloats the Reports
// chunk for everyone — including users who never tap "Export PDF".
// They're loaded lazily inside `downloadReportPdf` instead.
import type { jsPDF as JsPdfType, jsPDFOptions } from "jspdf";

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
      const base64 = await blobToBase64(blob);
      const writeRes = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
        // Encoding.UTF8 only works for text; binary needs no encoding
        // and a base64 payload, which is what we pass above.
        encoding: mimeType.startsWith("text/") ? Encoding.UTF8 : undefined,
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
        // instance) when the user cancels, so we check both shapes.
        const msg = err instanceof Error
          ? err.message
          : (err as any)?.message ?? (err as any)?.errorMessage ?? "";
        if (/cancel/i.test(String(msg))) return;
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
  const lines: string[] = [];
  
  lines.push("--- SUMMARY ---");
  lines.push(`"Report type","${report.periodLabel.replace(/"/g, '""')}"`);
  lines.push(`"Date range","${report.rangeLabel.replace(/"/g, '""')}"`);
  if (report.scopeLabel) lines.push(`"Categories","${report.scopeLabel.replace(/"/g, '""')}"`);
  lines.push(`"Total tracked (Hours)","${(report.totalSeconds / 3600).toFixed(2)}"`);
  const globalCurrency = report.categories[0]?.currency || report.paymentDetails?.currency || "USD";
  lines.push(`"Total earned","${(report.totalEarnings || 0).toFixed(2)}"`);
  lines.push(`"Currency","${globalCurrency}"`);

  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];
  for (const sec of sections) {
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    lines.push("");
    lines.push(`--- ${sec.title.toUpperCase().replace(/"/g, '""')} ---`);
    for (const [label, value] of paymentRows) {
      lines.push(`"${label.replace(/"/g, '""')}","${value.replace(/"/g, '""')}"`);
    }
  }

  if (report.categories.length) {
    lines.push("");
    lines.push("--- CATEGORY BREAKDOWN ---");
    lines.push("Category,Duration (Hours),Share (%),Rate / hour,Earned,Currency");
    for (const c of report.categories) {
      lines.push(`"${c.name.replace(/"/g, '""')}",${(c.seconds / 3600).toFixed(2)},${(c.pct * 100).toFixed(1)},${c.hourlyRate ?? ""},${(c.earnings || 0).toFixed(2)},"${c.currency || "USD"}"`);
    }
  }

  if (report.entries.length) {
    lines.push("");
    lines.push("--- ACTIVITY LOG ---");
    lines.push("Date,Started,Ended,Category,Task,Duration (Minutes),Duration (Hours),Rate / hour,Earned,Currency,Note");
    for (const e of report.entries) {
      lines.push(
        [
          e.date,
          e.startedAt,
          e.endedAt,
          `"${e.category.replace(/"/g, '""')}"`,
          `"${(e.taskTitle ?? "").replace(/"/g, '""')}"`,
          e.durationMin.toString(),
          (e.durationMin / 60).toFixed(2),
          e.hourlyRate ?? "",
          (e.earnings || 0).toFixed(2),
          `"${e.currency || "USD"}"`,
          `"${(e.note ?? "").replace(/"/g, '""')}"`,
        ].join(",")
      );
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
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
  const ink: RGB         = [17, 20, 32];     // headlines, primary values
  const body: RGB        = [50, 55, 70];     // body copy
  const sub: RGB         = [115, 120, 138];  // labels, captions
  const faint: RGB       = [180, 184, 200];  // page-number, hairlines
  const hairline: RGB    = [228, 231, 240];  // row separators, dividers
  const soft: RGB        = [248, 249, 252];  // alternating rows
  const cardBorder: RGB  = [225, 228, 240];  // stat-card outline
  const accent: RGB      = [99, 102, 241];   // indigo-500
  const accentSoft: RGB  = [139, 92, 246];   // violet-500 (second card)
  const success: RGB     = [16, 185, 129];   // emerald-500 (earnings)
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
    // Card body — white fill + soft hairline border. Looks like a printed
    // card stock rather than the heavier filled-grey blocks.
    doc.setFillColor(...white);
    doc.setDrawColor(...cardBorder);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, cardsY, cardW, cardH, 14, 14, "FD");
    // Accent strip on the left edge — 3pt wide, full height.
    doc.setFillColor(...dot);
    doc.roundedRect(x, cardsY, 3, cardH, 1.5, 1.5, "F");
    // Label
    doc.setFont(FONT, "bold");
    doc.setFontSize(7.5);
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
    // Segments left → right. Skip near-zero slices so a 0% category
    // doesn't leave a smear of off-colour pixels at the join.
    let segX = margin;
    for (const c of report.categories) {
      const segW = c.pct * usableW;
      if (segW < 1) continue;
      const [r, g, b] = hexToRgb(c.color || "#6366f1");
      doc.setFillColor(r, g, b);
      doc.rect(segX, cursorY, segW, barH, "F");
      segX += segW;
    }
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

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    cursorY = ensureRoom(cursorY, 96);
    // Section title is always just "Payment details"; the scope is shown
    // as a sub-eyebrow underneath so the layout doesn't collapse when the
    // category names are long or Cyrillic.
    sectionTitle(sections.length === 1 ? "Payment details" : `Payment details · ${si + 1} of ${sections.length}`, cursorY);
    cursorY += 16;
    // Scope sub-eyebrow — strip the "Payment — " prefix the caller adds.
    const scopeLabel = sec.title.replace(/^Payment\s*—\s*/i, "").trim();
    if (scopeLabel) {
      doc.setFont(FONT, "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...ink);
      doc.text(scopeLabel, margin, cursorY + 4);
      cursorY += 14;
    }
    // Payment key/value table.
    // Col 0 (label) and col 1 (value) use the SAME fontSize so the two-column
    // grid sits on a shared baseline — previously 9 vs 10 caused a half-line
    // shift that made values look mis-seated against their labels.
    autoTable(doc, {
      startY: cursorY,
      body: paymentRows,
      margin: { left: margin, right: margin },
      styles: {
        font: FONT,
        fontSize: 9.5,
        cellPadding: { top: 9, bottom: 9, left: 14, right: 14 },
        textColor: body,
        lineColor: hairline,
        lineWidth: 0,
        valign: "middle",
        overflow: "linebreak",
      },
      columnStyles: {
        0: { fontStyle: "bold", textColor: sub, cellWidth: 150 },
        1: { textColor: ink, fontStyle: "normal" },
      },
      alternateRowStyles: { fillColor: soft },
      theme: "plain",
    });
    cursorY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY) + 24;
  }

  // ── Category breakdown ───────────────────────────────────
  // FIX: header and body now share the same font size (10pt) so right-aligned
  // columns ("Earned", "Rate", "Time") land on the same visual anchor.
  // Previously headers at 7.5pt were positioned much further from the right
  // edge than body values at 10.5pt, creating the "column shifted right" look.
  //
  // dot col: cellWidth 20, zero horizontal padding — the circle is drawn
  // manually in didDrawCell; extra padding was wasting space and miscentring.
  if (report.categories.length) {
    cursorY = ensureRoom(cursorY, 120);
    sectionTitle("Category breakdown", cursorY);
    cursorY += 14;

    // Shared padding for both head and body so every row has the same rhythm.
    const CP = { top: 10, bottom: 10, left: 10, right: 10 };
    const HEAD_CP = { top: 7, bottom: 8, left: 10, right: 10 };
    const headFill: RGB = [242, 244, 250];

    autoTable(doc, {
      startY: cursorY,
      head: [["", "Category", "Time", "Share", "Rate / hr", "Earned"]],
      body: report.categories.map((c) => [
        "",
        c.name,
        fmtH(c.seconds),
        `${(c.pct * 100).toFixed(1)}%`,
        c.hourlyRate ? fmtMoney(c.hourlyRate, c.currency || "USD") : "—",
        c.earnings && c.earnings > 0 ? fmtMoney(c.earnings, c.currency || "USD") : "—",
      ]),
      margin: { left: margin, right: margin },
      styles: {
        font: FONT,
        fontSize: 10,
        cellPadding: CP,
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
        fontSize: 10,       // ← same as body; eliminates the right-edge drift
        cellPadding: HEAD_CP,
        lineColor: hairline,
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: soft },
      columnStyles: {
        // dot: tight, zero horizontal padding — circle drawn in didDrawCell
        0: { cellWidth: 20, cellPadding: { top: 10, bottom: 10, left: 0, right: 4 } },
        1: { fontStyle: "bold", textColor: ink },
        2: { halign: "right", cellWidth: 72, fontStyle: "bold" },
        3: { halign: "right", cellWidth: 54, textColor: sub },
        4: { halign: "right", cellWidth: 96, textColor: sub },
        5: { halign: "right", cellWidth: 96, fontStyle: "bold" },
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
        // Colour dot — drawn at cell centre, size proportional to row height.
        if (data.section === "body" && data.column.index === 0) {
          const row = report.categories[data.row.index];
          if (row) {
            const [r, g, b] = hexToRgb(row.color || "#6366f1");
            doc.setFillColor(r, g, b);
            const cx = data.cell.x + data.cell.width - 4;
            const cy = data.cell.y + data.cell.height / 2;
            doc.circle(cx, cy, 3.8, "F");
          }
        }
        // Accent underline beneath header row once (last column only).
        if (data.section === "head" && data.column.index === 5) {
          doc.setDrawColor(...accent);
          doc.setLineWidth(1);
          const lineY = data.cell.y + data.cell.height;
          doc.line(margin, lineY, pageW - margin, lineY);
        }
      },
    });
    cursorY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY) + 30;
  }

  // ── Activity log ─────────────────────────────────────────
  // Same fix applied: headers and body share fontSize 9. Start/End columns
  // are 52px (was 44) so "10:30 AM" fits without truncation. Earned column
  // is 78px (was 68) to handle wider currency strings like "CA$1,234".
  // Head and body use the same cellPadding left/right so right-aligned text
  // in header and body cells shares the same right anchor pixel.
  if (report.entries.length) {
    cursorY = ensureRoom(cursorY, 100);
    sectionTitle(
      `Activity log · ${report.entries.length} ${report.entries.length === 1 ? "session" : "sessions"}`,
      cursorY,
    );
    cursorY += 14;

    const headFill2: RGB = [242, 244, 250];

    autoTable(doc, {
      startY: cursorY,
      head: [["Date", "Start", "End", "Category", "Task", "Duration", "Earned", "Note"]],
      body: report.entries.map((e) => [
        e.date,
        e.startedAt,
        e.endedAt,
        e.category,
        e.taskTitle ?? "",
        `${e.durationMin}m`,
        e.earnings && e.earnings > 0 ? fmtMoney(e.earnings, e.currency || "USD") : "—",
        e.note ?? "",
      ]),
      margin: { left: margin, right: margin, bottom: 56 },
      styles: {
        font: FONT,
        fontSize: 9,
        cellPadding: { top: 8, bottom: 8, left: 8, right: 8 },
        textColor: body,
        lineColor: hairline,
        lineWidth: 0,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: headFill2,
        textColor: sub,
        fontStyle: "bold",
        fontSize: 9,        // ← matches body; right-aligned headers now share
        cellPadding: { top: 6, bottom: 7, left: 8, right: 8 }, // same L/R as body
        lineColor: hairline,
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: soft },
      columnStyles: {
        0: { textColor: ink, fontStyle: "bold", cellWidth: 58 },
        1: { textColor: sub, cellWidth: 46, halign: "right" },  // fits "10:30 AM"
        2: { textColor: sub, cellWidth: 46, halign: "right" },
        3: { textColor: ink, cellWidth: 72, overflow: "ellipsize" },
        4: { textColor: ink, cellWidth: 96, overflow: "ellipsize" }, // Task title
        5: { halign: "right", textColor: ink, fontStyle: "bold", cellWidth: 48 },
        6: { halign: "right", textColor: ink, fontStyle: "bold", cellWidth: 74 },
        7: { textColor: sub, fontSize: 8.5 },
      },
      theme: "plain",
      didParseCell: (data) => {
        if (
          data.section === "body" &&
          data.column.index === 6 &&
          data.cell.raw === "—"
        ) {
          data.cell.styles.textColor = faint;
          data.cell.styles.fontStyle = "normal";
        }
      },
      didDrawCell: (data) => {
        if (data.section === "head" && data.column.index === 7) {
          doc.setDrawColor(...accent);
          doc.setLineWidth(1);
          const lineY = data.cell.y + data.cell.height;
          doc.line(margin, lineY, pageW - margin, lineY);
        }
      },
    });
  } else {
    cursorY = ensureRoom(cursorY, 50);
    sectionTitle("Activity log", cursorY);
    cursorY += 30;
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