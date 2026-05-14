import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportCategoryRow = {
  name: string;
  color: string;
  seconds: number;
  pct: number;
  hourlyRate?: number | null;
  earnings?: number;
};

export type ReportEntryRow = {
  date: string;
  startedAt: string;
  endedAt: string;
  category: string;
  durationMin: number;
  hourlyRate?: number | null;
  earnings?: number;
  note: string | null;
};

export type ReportPaymentDetails = {
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
const fmtMoney = (amount: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2,
  }).format(amount);

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
  lines.push(`Total earned,${fmtMoney(report.totalEarnings || 0)}`);
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
    lines.push(`"${c.name.replace(/"/g, '""')}",${fmtH(c.seconds)},${(c.pct * 100).toFixed(1)}%,${c.hourlyRate ?? ""},${fmtMoney(c.earnings || 0)}`);
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
        fmtMoney(e.earnings || 0),
        `"${(e.note ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${filenameBase(report)}.csv`);
}

export function downloadReportPdf(report: ReportPayload) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const sections = report.paymentSections?.length
    ? report.paymentSections
    : report.paymentDetails
      ? [{ title: "Payment details", details: report.paymentDetails }]
      : [];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Time report", 40, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`${report.periodLabel} — ${report.rangeLabel}`, 40, 80);
  if (report.scopeLabel) doc.text(`Categories: ${report.scopeLabel}`, 40, 98);
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(fmtH(report.totalSeconds), 40, 124);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text("total tracked", 40, 140);
  if (report.totalEarnings && report.totalEarnings > 0) {
    doc.setTextColor(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(fmtMoney(report.totalEarnings), 220, 124);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("estimated earned", 220, 140);
  }

  let startY = 170;
  for (const sec of sections) {
    const paymentRows = paymentDetailRows(sec.details);
    if (!paymentRows.length) continue;
    autoTable(doc, {
      startY,
      head: [[sec.title, ""]],
      body: paymentRows,
      styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [245, 245, 245], textColor: 30 },
      theme: "grid",
    });
    startY = ((doc as any).lastAutoTable?.finalY || startY) + 18;
  }

  autoTable(doc, {
    startY,
    head: [["Category", "Time", "%", "Rate / h", "Earned"]],
    body: report.categories.map((c) => [c.name, fmtH(c.seconds), `${(c.pct * 100).toFixed(1)}%`, c.hourlyRate ? fmtMoney(c.hourlyRate) : "—", fmtMoney(c.earnings || 0)]),
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 },
    theme: "grid",
  });
  startY = ((doc as any).lastAutoTable?.finalY || startY) + 18;

  autoTable(doc, {
    startY,
    head: [["Date", "Started", "Ended", "Category", "Min", "Earned", "Note"]],
    body: report.entries.map((e) => [
      e.date,
      e.startedAt,
      e.endedAt,
      e.category,
      e.durationMin.toString(),
      fmtMoney(e.earnings || 0),
      e.note ?? "",
    ]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [240, 240, 240], textColor: 30 },
    theme: "striped",
  });

  doc.save(`${filenameBase(report)}.pdf`);
}