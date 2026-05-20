// ReportView — the client island root for the Report page body (US1 + US2).
//
// Receives the server-projected `ReportReadModel` and renders the `.dr-body`:
// `<ReportStaffList>` on the left and the right panel — `<TechDetail>` when a
// technician is selected, else `<AllStaffOverview>`.
//
// Owns the `selectedTechId` state. The left list's "All Staff" button clears
// the selection (back to the overview); a tech card selects that tech. A
// selection that no longer resolves to a technician (e.g. after a period
// change drops that tech) falls back to the overview.
//
// Also owns `expandedTxIds` — the set of ticket ids whose deduction breakdown
// is open in the per-technician detail view (US3). The expand state is
// per-view; it is not preserved across a technician change.
//
// Period stepping is NOT client state — US4's `<ReportPeriodControls>` (a
// sibling Server Component) drives it through `?period=&offset=` URL
// navigation, so each window is a fresh server fetch (research R11).

"use client";

import { useCallback, useState } from "react";

import type { ReportReadModel } from "@/lib/report/aggregate";
import { AllStaffOverview } from "@/components/lacquer/report/all-staff-overview";
import { ReportStaffList } from "@/components/lacquer/report/report-staff-list";
import { TechDetail } from "@/components/lacquer/report/tech-detail";

export type ReportViewProps = {
  report: ReportReadModel;
};

export function ReportView({ report }: ReportViewProps) {
  // `null` = the All-Staff overview; a staff id = that technician's detail view.
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  // The ticket ids whose deduction breakdown is expanded in the detail view.
  const [expandedTxIds, setExpandedTxIds] = useState<ReadonlySet<string>>(new Set());

  // Selecting a technician (or returning to the overview) starts with every
  // transaction collapsed — the expand state is per-view, not preserved.
  const selectTech = useCallback((staffId: string | null) => {
    setSelectedTechId(staffId);
    setExpandedTxIds(new Set());
  }, []);

  // Toggle one transaction's breakdown — collapses it when already expanded.
  const toggleTx = useCallback((ticketId: string) => {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  }, []);

  // Resolve the selection — a stale id (the tech is no longer in the window)
  // falls back to the overview rather than rendering an empty detail.
  const selectedTech =
    selectedTechId === null
      ? null
      : (report.technicians.find((t) => t.staffId === selectedTechId) ?? null);

  return (
    <div className="dr-body">
      <ReportStaffList
        technicians={report.technicians}
        totals={report.totals}
        selectedTechId={selectedTech ? selectedTech.staffId : null}
        onSelect={selectTech}
      />
      <div className="dr-right">
        {selectedTech ? (
          <TechDetail
            technician={selectedTech}
            expandedTxIds={expandedTxIds}
            onToggleTx={toggleTx}
          />
        ) : (
          <AllStaffOverview technicians={report.technicians} totals={report.totals} />
        )}
      </div>
    </div>
  );
}
