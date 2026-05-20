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

function triggerDownload(blob: Blob, filename: string) {
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

export function downloadReportCsv(report: ReportPayload) {
  const lines: string[] = [];
  lines.push(`Time report,${report.periodLabel},${report.rangeLabel}`);
  if (report.scopeLabel) lines.push(`Categories,"${report.scopeLabel.replace(/"/g, '""')}"`);
  lines.push(`Total tracked,${fmtH(report.totalSeconds)}`);
  lines.push(`Total earned,${fmtMoney(report.totalEarnings || 0, report.categories[0]?.currency || report.paymentDetails?.currency || "USD")}`);
  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];
  for (const sec of sections) {
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    lines.push("");
    lines.push(sec.title.replace(/"/g, '""'));
    for (const [label, value] of paymentRows) {
      lines.push(`"${label.replace(/"/g, '""')}","${value.replace(/"/g, '""')}"`);
    }
  }
  lines.push("");
  lines.push("Category,Time,Percent,Rate / hour,Earned");
  for (const c of report.categories) {
    lines.push(`"${c.name.replace(/"/g, '""')}",${fmtH(c.seconds)},${(c.pct * 100).toFixed(1)}%,${c.hourlyRate ?? ""},${fmtMoney(c.earnings || 0, c.currency || "USD")}`);
  }
  lines.push("");
  lines.push("Date,Started,Ended,Category,Duration (min),Rate / hour,Earned,Note");
  for (const e of report.entries) {
    lines.push(
      [
        e.date,
        e.startedAt,
        e.endedAt,
        `"${e.category.replace(/"/g, '""')}"`,
        e.durationMin.toString(),
        e.hourlyRate ?? "",
        fmtMoney(e.earnings || 0, e.currency || "USD"),
        `"${(e.note ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${filenameBase(report)}.csv`);
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

export async function downloadReportPdf(report: ReportPayload) {
  // Lazy-load the heavyweight PDF deps. Vite splits these into a
  // separate chunk that only ships when the user actually exports.
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  // Cast options so TS picks up the same shape after the type-only import above.
  const doc: JsPdfType = new jsPDF({ unit: "pt", format: "a4" } as jsPDFOptions);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const accent: [number, number, number] = [99, 102, 241]; // indigo-500
  const ink: [number, number, number] = [18, 20, 28];
  const sub: [number, number, number] = [120, 124, 138];
  const soft: [number, number, number] = [244, 245, 250];

  // Header band
  doc.setFillColor(...ink);
  doc.rect(0, 0, pageW, 110, "F");
  doc.setFillColor(...accent);
  doc.rect(0, 110, pageW, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("TIME REPORT", margin, 42, { charSpace: 2 });

  doc.setFontSize(22);
  doc.text(`${report.periodLabel} · ${report.rangeLabel}`, margin, 70);

  if (report.scopeLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(190, 192, 210);
    doc.text(report.scopeLabel, margin, 90);
  }

  // Right side: generation date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 184, 205);
  const generated = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  doc.text(`Generated ${generated}`, pageW - margin, 42, { align: "right" });

  // Stat cards
  const cardsY = 138;
  const cardH = 88;
  const gap = 14;
  const hasEarnings = (report.totalEarnings || 0) > 0;
  const cardW = hasEarnings ? (pageW - margin * 2 - gap) / 2 : pageW - margin * 2;

  const drawCard = (x: number, w: number, label: string, value: string, tone: [number, number, number]) => {
    doc.setFillColor(...soft);
    doc.roundedRect(x, cardsY, w, cardH, 12, 12, "F");
    doc.setFillColor(...tone);
    doc.rect(x, cardsY, 3, cardH, "F");
    doc.setTextColor(...sub);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(label.toUpperCase(), x + 18, cardsY + 24, { charSpace: 1.5 });
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text(value, x + 18, cardsY + 60);
  };

  drawCard(margin, cardW, "Total tracked", fmtH(report.totalSeconds), accent);
  if (hasEarnings) {
    const currency = report.categories[0]?.currency || report.paymentDetails?.currency || "USD";
    drawCard(margin + cardW + gap, cardW, "Estimated earned", fmtMoney(report.totalEarnings || 0, currency), [16, 185, 129]);
  }

  let cursorY = cardsY + cardH + 28;

  // Payment sections
  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];

  for (const sec of sections) {
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    autoTable(doc, {
      startY: cursorY,
      head: [[{ content: sec.title, colSpan: 2 }]],
      body: paymentRows,
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 7, textColor: ink, lineColor: [230, 232, 240], lineWidth: 0.5 },
      headStyles: { fillColor: ink, textColor: 255, fontStyle: "bold", fontSize: 9, cellPadding: 8 },
      columnStyles: { 0: { fontStyle: "bold", textColor: sub, cellWidth: 130 }, 1: { textColor: ink } },
      theme: "grid",
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY) + 18;
  }

  // Category breakdown
  if (report.categories.length) {
    autoTable(doc, {
      startY: cursorY,
      head: [["", "Category", "Time", "Share", "Rate / h", "Earned"]],
      body: report.categories.map((c) => [
        "",
        c.name,
        fmtH(c.seconds),
        `${(c.pct * 100).toFixed(1)}%`,
        c.hourlyRate ? fmtMoney(c.hourlyRate, c.currency || "USD") : "—",
        fmtMoney(c.earnings || 0, c.currency || "USD"),
      ]),
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 10, cellPadding: 9, textColor: ink, lineColor: [232, 234, 242], lineWidth: 0.5 },
      headStyles: { fillColor: ink, textColor: 255, fontStyle: "bold", fontSize: 9, cellPadding: 9 },
      alternateRowStyles: { fillColor: [250, 251, 254] },
      columnStyles: {
        0: { cellWidth: 18 },
        2: { halign: "right", cellWidth: 70 },
        3: { halign: "right", cellWidth: 55 },
        4: { halign: "right", cellWidth: 75 },
        5: { halign: "right", cellWidth: 80, fontStyle: "bold" },
      },
      theme: "grid",
      didDrawCell: (data) => {
        if (data.section === "body" && data.column.index === 0) {
          const row = report.categories[data.row.index];
          if (row) {
            const [r, g, b] = hexToRgb(row.color || "#6366f1");
            doc.setFillColor(r, g, b);
            const cx = data.cell.x + data.cell.width / 2;
            const cy = data.cell.y + data.cell.height / 2;
            doc.circle(cx, cy, 3.2, "F");
          }
        }
      },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY) + 22;
  }

  // Detailed entries
  if (report.entries.length) {
    autoTable(doc, {
      startY: cursorY,
      head: [["Date", "Start", "End", "Category", "Min", "Earned", "Note"]],
      body: report.entries.map((e) => [
        e.date,
        e.startedAt,
        e.endedAt,
        e.category,
        e.durationMin.toString(),
        fmtMoney(e.earnings || 0, e.currency || "USD"),
        e.note ?? "",
      ]),
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 6, textColor: ink, lineColor: [235, 237, 244], lineWidth: 0.4 },
      headStyles: { fillColor: soft, textColor: ink, fontStyle: "bold", fontSize: 8.5, cellPadding: 7 },
      alternateRowStyles: { fillColor: [252, 253, 255] },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right", fontStyle: "bold" },
      },
      theme: "grid",
    });
  } else {
    doc.setTextColor(...sub);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.text("No tracker entries in this period yet.", margin, cursorY + 12);
  }

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(230, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 36, pageW - margin, pageH - 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...sub);
    doc.text("DayDraft · Time report", margin, pageH - 20);
    doc.text(`${i} / ${pageCount}`, pageW - margin, pageH - 20, { align: "right" });
  }

  doc.save(`${filenameBase(report)}.pdf`);
}