import "@/styles/end-of-day.css";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function HistoryDetailNotFound() {
  return (
    <div
      className="eod-app"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        className="eod-history-empty"
        data-slot="eod-history-detail-not-found"
        style={{ gap: 16 }}
      >
        <div className="eod-history-empty-title">Session not found</div>
        <div>That cash count is no longer available.</div>
        <Link
          href="/end-of-day/history"
          className="eod-detail-back"
          style={{ alignSelf: "center" }}
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          Back to past cash counts
        </Link>
      </div>
    </div>
  );
}
