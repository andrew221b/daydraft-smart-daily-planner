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
      maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${Math.abs(amount) >= 100 ? amount.toFixed(0) : amount.toFixed(2)} ${code}`;
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
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
    lines.push("Date,Started,Ended,Category,Duration (Minutes),Duration (Hours),Rate / hour,Earned,Currency,Note");
    for (const e of report.entries) {
      lines.push(
        [
          e.date,
          e.startedAt,
          e.endedAt,
          `"${e.category.replace(/"/g, '""')}"`,
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

export async function downloadReportPdf(report: ReportPayload) {
  // Lazy-load the heavyweight PDF deps. Vite splits these into a
  // separate chunk that only ships when the user actually exports.
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc: JsPdfType = new jsPDF({ unit: "pt", format: "a4" } as jsPDFOptions);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;

  // ── Palette ───────────────────────────────────────────────
  // Editorial light theme. Single accent (indigo) + emerald for money.
  // Everything else lives on a tight neutral ramp so totals + numbers do
  // the visual heavy lifting.
  const ink: RGB         = [18, 20, 28];     // headlines, primary values
  const body: RGB        = [42, 46, 60];     // body copy
  const sub: RGB         = [110, 115, 130];  // labels, captions
  const faint: RGB       = [180, 184, 200];  // page-number, hairlines
  const hairline: RGB    = [228, 231, 240];  // row separators, dividers
  const soft: RGB        = [248, 249, 252];  // alternating rows
  const cardBg: RGB      = [243, 245, 250];  // stat card surface
  const accent: RGB      = [99, 102, 241];   // indigo-500
  const accentSoft: RGB  = [148, 113, 240];  // mid-tone for the second card
  const success: RGB     = [16, 185, 129];   // emerald-500 (earnings)
  const white: RGB       = [255, 255, 255];

  const usableW = pageW - margin * 2;

  // ── Helpers ───────────────────────────────────────────────
  const sectionTitle = (text: string, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...sub);
    doc.text(text.toUpperCase(), margin, y, { charSpace: 1.8 });
    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.5);
    doc.line(margin, y + 7, pageW - margin, y + 7);
  };

  const ensureRoom = (cursorY: number, need: number): number => {
    if (cursorY + need <= pageH - 64) return cursorY;
    doc.addPage();
    return margin + 12;
  };

  // ── Header band ───────────────────────────────────────────
  doc.setFillColor(...ink);
  doc.rect(0, 0, pageW, 138, "F");
  doc.setFillColor(...accent);
  doc.rect(0, 138, pageW, 2, "F");

  // Brand badge — small rounded mark + wordmark, mimics the app icon
  const markX = margin;
  const markY = 36;
  doc.setFillColor(...accent);
  doc.roundedRect(markX, markY, 20, 20, 5, 5, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(markX + 10, markY + 10, 3.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...white);
  doc.text("DayDraft", markX + 28, markY + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(190, 192, 215);
  doc.text("TIME REPORT", markX + 28, markY + 21, { charSpace: 1.8 });

  // Period (large) + range (small) — left-aligned hero text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...white);
  doc.text(report.periodLabel, margin, 100);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(195, 198, 220);
  doc.text(report.rangeLabel, margin, 120);

  // Right-rail meta — generation date + scope (if set)
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 184, 205);
  doc.text(`Generated ${generated}`, pageW - margin, 40, { align: "right" });
  if (report.scopeLabel) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...white);
    doc.text(report.scopeLabel, pageW - margin, 56, { align: "right" });
  }

  // ── Stat cards ────────────────────────────────────────────
  const cardsY = 168;
  const cardH = 102;
  const gap = 14;
  const hasEarnings = (report.totalEarnings || 0) > 0;
  const sessionCount = report.entries.length;
  const cardCount = hasEarnings ? 3 : 2;
  const cardW = (usableW - gap * (cardCount - 1)) / cardCount;

  const drawCard = (x: number, label: string, value: string, dot: RGB) => {
    doc.setFillColor(...cardBg);
    doc.roundedRect(x, cardsY, cardW, cardH, 14, 14, "F");
    // Accent dot top-right
    doc.setFillColor(...dot);
    doc.circle(x + cardW - 20, cardsY + 20, 4.2, "F");
    // Label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...sub);
    doc.text(label.toUpperCase(), x + 20, cardsY + 32, { charSpace: 1.5 });
    // Value (autoscale a touch for long monetary strings)
    const targetMaxW = cardW - 40;
    let valueSize = 28;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(valueSize);
    while (valueSize > 16 && doc.getTextWidth(value) > targetMaxW) {
      valueSize -= 1.5;
      doc.setFontSize(valueSize);
    }
    doc.setTextColor(...ink);
    doc.text(value, x + 20, cardsY + 76);
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
  if (report.categories.length > 0 && report.totalSeconds > 0) {
    cursorY = ensureRoom(cursorY, 110);
    sectionTitle("Time distribution", cursorY);
    cursorY += 24;

    const barH = 12;
    // Bar background
    doc.setFillColor(...soft);
    doc.roundedRect(margin, cursorY, usableW, barH, 6, 6, "F");
    // Segments — drawn left to right, no individual rounding (the
    // background's rounded corners are masked by Adobe / Preview anyway).
    let segX = margin;
    for (const c of report.categories) {
      const segW = c.pct * usableW;
      if (segW < 0.5) continue;
      const [r, g, b] = hexToRgb(c.color || "#6366f1");
      doc.setFillColor(r, g, b);
      doc.rect(segX, cursorY, segW, barH, "F");
      segX += segW;
    }
    cursorY += barH + 18;

    // Legend chips — dot + name + percent, wraps to next line if needed.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const lineH = 16;
    let chipX = margin;
    for (const c of report.categories) {
      const label = `${c.name}  ${(c.pct * 100).toFixed(0)}%`;
      const labelW = doc.getTextWidth(label);
      const chipW = 12 + labelW + 20; // dot + label + right gap
      if (chipX + chipW > pageW - margin) {
        chipX = margin;
        cursorY += lineH;
      }
      const [r, g, b] = hexToRgb(c.color || "#6366f1");
      doc.setFillColor(r, g, b);
      doc.circle(chipX + 4, cursorY + 4, 3.2, "F");
      doc.setTextColor(...body);
      doc.text(label, chipX + 13, cursorY + 7);
      chipX += chipW;
    }
    cursorY += lineH + 18;
  }

  // ── Payment details ──────────────────────────────────────
  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];

  for (const sec of sections) {
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    cursorY = ensureRoom(cursorY, 80);
    sectionTitle(sec.title, cursorY);
    cursorY += 14;
    autoTable(doc, {
      startY: cursorY,
      body: paymentRows,
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 10, cellPadding: 9, textColor: body, lineColor: hairline, lineWidth: 0, valign: "middle" },
      columnStyles: { 0: { fontStyle: "bold", textColor: sub, cellWidth: 140 }, 1: { textColor: ink } },
      alternateRowStyles: { fillColor: soft },
      theme: "plain",
    });
    cursorY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY) + 26;
  }

  // ── Category breakdown ───────────────────────────────────
  if (report.categories.length) {
    cursorY = ensureRoom(cursorY, 120);
    sectionTitle("Category breakdown", cursorY);
    cursorY += 14;

    autoTable(doc, {
      startY: cursorY,
      head: [["", "Category", "Time", "Share", "Rate", "Earned"]],
      body: report.categories.map((c) => [
        "",
        c.name,
        fmtH(c.seconds),
        `${(c.pct * 100).toFixed(1)}%`,
        c.hourlyRate ? fmtMoney(c.hourlyRate, c.currency || "USD") : "—",
        c.earnings && c.earnings > 0 ? fmtMoney(c.earnings, c.currency || "USD") : "—",
      ]),
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 10.5, cellPadding: 11, textColor: ink, lineColor: hairline, lineWidth: 0, valign: "middle" },
      headStyles: {
        fillColor: white,
        textColor: sub,
        fontStyle: "bold",
        fontSize: 8,
        cellPadding: 8,
        lineColor: hairline,
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: soft },
      columnStyles: {
        0: { cellWidth: 22 },
        2: { halign: "right", cellWidth: 72 },
        3: { halign: "right", cellWidth: 58, textColor: sub },
        4: { halign: "right", cellWidth: 78, textColor: sub },
        5: { halign: "right", cellWidth: 96, fontStyle: "bold" },
      },
      theme: "plain",
      didParseCell: (data) => {
        // Underline header row with a hairline by drawing it after the cell.
        if (data.section === "head") {
          data.cell.styles.cellPadding = 8;
        }
      },
      didDrawCell: (data) => {
        // Colour dot for each category in the first column.
        if (data.section === "body" && data.column.index === 0) {
          const row = report.categories[data.row.index];
          if (row) {
            const [r, g, b] = hexToRgb(row.color || "#6366f1");
            doc.setFillColor(r, g, b);
            const cx = data.cell.x + data.cell.width / 2;
            const cy = data.cell.y + data.cell.height / 2;
            doc.circle(cx, cy, 3.8, "F");
          }
        }
        // Hairline beneath the header row (drawn once at last column).
        if (data.section === "head" && data.column.index === 5) {
          doc.setDrawColor(...hairline);
          doc.setLineWidth(0.6);
          const lineY = data.cell.y + data.cell.height;
          doc.line(margin, lineY, pageW - margin, lineY);
        }
      },
    });
    cursorY = ((doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || cursorY) + 30;
  }

  // ── Activity log ─────────────────────────────────────────
  if (report.entries.length) {
    cursorY = ensureRoom(cursorY, 100);
    sectionTitle(`Activity log · ${report.entries.length} ${report.entries.length === 1 ? "session" : "sessions"}`, cursorY);
    cursorY += 14;

    autoTable(doc, {
      startY: cursorY,
      head: [["Date", "Start", "End", "Category", "Duration", "Earned", "Note"]],
      body: report.entries.map((e) => [
        e.date,
        e.startedAt,
        e.endedAt,
        e.category,
        `${e.durationMin}m`,
        e.earnings && e.earnings > 0 ? fmtMoney(e.earnings, e.currency || "USD") : "—",
        e.note ?? "",
      ]),
      margin: { left: margin, right: margin, bottom: 50 },
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 8,
        textColor: body,
        lineColor: hairline,
        lineWidth: 0,
        valign: "middle",
      },
      headStyles: {
        fillColor: white,
        textColor: sub,
        fontStyle: "bold",
        fontSize: 8,
        cellPadding: 8,
        lineColor: hairline,
        lineWidth: 0,
      },
      alternateRowStyles: { fillColor: soft },
      columnStyles: {
        0: { textColor: ink, fontStyle: "bold", cellWidth: 70 },
        1: { textColor: sub, cellWidth: 50 },
        2: { textColor: sub, cellWidth: 50 },
        4: { halign: "right", textColor: ink, fontStyle: "bold", cellWidth: 70 },
        5: { halign: "right", textColor: ink, fontStyle: "bold", cellWidth: 80 },
        6: { textColor: sub },
      },
      theme: "plain",
      didDrawCell: (data) => {
        // Header underline once
        if (data.section === "head" && data.column.index === 6) {
          doc.setDrawColor(...hairline);
          doc.setLineWidth(0.6);
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
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10.5);
    doc.text("No tracker entries in this period yet.", margin, cursorY);
  }

  // ── Footer on every page ────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...hairline);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 32, pageW - margin, pageH - 32);

    // Brand mark (small)
    doc.setFillColor(...accent);
    doc.roundedRect(margin, pageH - 23, 10, 10, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...sub);
    doc.text("DAYDRAFT", margin + 16, pageH - 15, { charSpace: 1.5 });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...faint);
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 15, { align: "right" });
  }

  // `doc.save()` calls the same `<a download>` trick we route around in
  // `triggerDownload` — bypass it so the iOS share sheet path kicks in.
  const pdfBlob = doc.output("blob") as Blob;
  await triggerDownload(pdfBlob, `${filenameBase(report)}.pdf`, "application/pdf");
}