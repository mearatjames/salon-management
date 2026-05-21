// EmptyFeedState — calm empty-state slot for the recent-transactions feed
// when no paid tickets have closed today (FR-013). Server Component.
//
// Sized to roughly match an empty `.tx-feed-list` so the surrounding card
// container's overall height stays close to the populated case (the feed
// header — title + inert "View all" button — still renders above).

export function EmptyFeedState() {
  return (
    <div
      data-slot="empty-feed-state"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        minHeight: 120,
        color: "var(--muted-foreground)",
        fontSize: 12,
      }}
    >
      No transactions yet today.
    </div>
  );
}
