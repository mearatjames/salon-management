"use client";

// ReportActions — the Print + Export CSV buttons in the Report page header
// (contract C6, FR-027 / FR-028).
//
// Adapted from `design-system/prototypes/transaction/DayReport.jsx` (the
// `tp-head .actions` block — its `<button onClick={window.print()}>` Print and
// `exportCSV` Export pair). The prototype's inline SVGs are replaced with
// Lucide icons (Constitution Principle I — Lucide only, 1.5px stroke).
//
// Client island: both actions are browser-only — `window.print()` and an
// anchor-click download — so this is the page's single `"use client"` surface
// for User Story 5. The CSV string itself is built by the pure
// `buildReportCsv` (`lib/report/csv.ts`); this component only triggers the
// download. The Server Component (`app/(studio)/report/page.tsx`) hands it the
// already-projected `report` + resolved `window`.

import { Download, Printer } from "lucide-react";

import type { ReportReadModel } from "@/lib/report/aggregate";
import type { ReportWindow } from "@/lib/report/window";
import { buildReportCsv } from "@/lib/report/csv";

export type ReportActionsProps = {
  report: ReportReadModel;
  window: ReportWindow;
};

export function ReportActions({ report, window: reportWindow }: ReportActionsProps) {
  // Print — `window.print()` captures the live DOM, so whichever view is on
  // screen (overview or a tech's detail) prints. The `@media print` block in
  // `styles/report.css` strips the studio chrome from the printout.
  const handlePrint = () => {
    window.print();
  };

  // Export — build the CSV via the pure builder, then download it through a
  // transient `<a download>` pointed at a `data:text/csv` URL. No server
  // round-trip (FR-028 / research R14).
  const handleExport = () => {
    const csv = buildReportCsv(report, reportWindow);
    const anchor = document.createElement("a");
    anchor.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    anchor.download = `Report-${reportWindow.rangeLabel}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <div className="actions" data-slot="report-actions">
      <button type="button" className="tp-btn-outline" onClick={handlePrint}>
        <Printer size={16} strokeWidth={1.5} aria-hidden="true" />
        Print
      </button>
      <button type="button" className="tp-btn-outline" onClick={handleExport}>
        <Download size={16} strokeWidth={1.5} aria-hidden="true" />
        Export CSV
      </button>
    </div>
  );
}
