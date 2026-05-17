// HistoryEmpty — calm empty-state slot for the Past Cash Counts list
// (feature 020, US1). Server Component, pure presentational.
//
// Mirrors the rhythm of `components/lacquer/empty-feed-state.tsx`: a
// muted, centered block sized to roughly match a populated list height.
// All values resolve to tokens via the `.eod-history-empty` class in
// `styles/end-of-day.css` (Constitution Principle I).

export function HistoryEmpty() {
  return (
    <div className="eod-history-empty" data-slot="eod-history-empty">
      Closed cash counts will appear here. Close out today&rsquo;s drawer on the End of Day page to
      start your history.
    </div>
  );
}
