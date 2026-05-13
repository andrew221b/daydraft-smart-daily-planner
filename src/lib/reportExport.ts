import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportCategoryRow = {
  name: string;
  color: string;
  seconds: number;
  pct: number;
};

export type ReportEntryRow = {
  date: string;
  startedAt: string;
  endedAt: string;
  category: string;
  durationMin: number;
  note: string | null;
};

export type ReportPayload = {
  periodLabel: string;
  rangeLabel: string;
  totalSeconds: number;
  categories: ReportCategoryRow[];
  entries: ReportEntryRow[];
};

const fmtH = (sec: number) => {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
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

export function downloadReportCsv(report: ReportPayload) {
  const lines: string[] = [];
  lines.push(`Time report,${report.periodLabel},${report.rangeLabel}`);
  lines.push(`Total tracked,${fmtH(report.totalSeconds)}`);
  lines.push("");
  lines.push("Category,Time,Percent");
  for (const c of report.categories) {
    lines.push(`"${c.name.replace(/"/g, '""')}",${fmtH(c.seconds)},${(c.pct * 100).toFixed(1)}%`);
  }
  lines.push("");
  lines.push("Date,Started,Ended,Category,Duration (min),Note");
  for (const e of report.entries) {
    lines.push(
      [
        e.date,
        e.startedAt,
        e.endedAt,
        `"${e.category.replace(/"/g, '""')}"`,
        e.durationMin.toString(),
        `"${(e.note ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `time-report-${report.periodLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`);
}

export function downloadReportPdf(report: ReportPayload) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Time report", 40, 60);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`${report.periodLabel} — ${report.rangeLabel}`, 40, 80);
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text(fmtH(report.totalSeconds), 40, 124);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text("total tracked", 40, 140);

  autoTable(doc, {
    startY: 170,
    head: [["Category", "Time", "%"]],
    body: report.categories.map((c) => [c.name, fmtH(c.seconds), `${(c.pct * 100).toFixed(1)}%`]),
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 30, 30], textColor: 255 },
    theme: "grid",
  });

  autoTable(doc, {
    head: [["Date", "Started", "Ended", "Category", "Min", "Note"]],
    body: report.entries.map((e) => [
      e.date,
      e.startedAt,
      e.endedAt,
      e.category,
      e.durationMin.toString(),
      e.note ?? "",
    ]),
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [240, 240, 240], textColor: 30 },
    theme: "striped",
  });

  doc.save(`time-report-${report.periodLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
}