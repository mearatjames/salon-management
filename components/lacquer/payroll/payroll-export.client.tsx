"use client";

// PayrollExport — the Export CSV button in the Payroll page header (US1).
//
// Client island: the download is browser-only — an anchor click against a
// `data:text/csv` URL — so this is a `"use client"` surface. The CSV string
// itself is built by the pure `buildPayrollCsv` (`lib/payroll/csv.ts`); this
// component only triggers the download. The Server Component
// (`app/(studio)/payroll/page.tsx`) hands it the already-projected ledger
// model.
//
// Adapted from `design-system/prototypes/payroll/PayrollPulse.jsx` (the
// `Export CSV` button). The prototype's inline SVG is replaced with a Lucide
// icon (Constitution Principle I — Lucide only, 1.5px stroke).

import { Download } from "lucide-react";

import type { PayrollLedgerModel } from "@/lib/payroll/aggregate";
import { buildPayrollCsv } from "@/lib/payroll/csv";

export type PayrollExportProps = {
  model: PayrollLedgerModel;
};

export function PayrollExport({ model }: PayrollExportProps) {
  // Export — build the CSV via the pure builder, then download it through a
  // transient `<a download>` pointed at a `data:text/csv` URL. No server
  // round-trip.
  const handleExport = () => {
    const csv = buildPayrollCsv(model);
    const anchor = document.createElement("a");
    anchor.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    anchor.download = `Payroll-${model.period.label}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <button
      type="button"
      className="pr-btn-outline"
      onClick={handleExport}
      data-slot="payroll-export"
    >
      <Download size={16} strokeWidth={1.5} aria-hidden="true" />
      Export CSV
    </button>
  );
}
