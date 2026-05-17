import "@/styles/end-of-day.css";

import { notFound, redirect } from "next/navigation";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { loadCashHistoryDetail } from "@/lib/end-of-day/history";
import { DetailView } from "@/components/lacquer/eod/history/detail-view";

export const dynamic = "force-dynamic";

export default async function HistoryDetailPage({
  params,
}: {
  // Next.js 16 App Router — params is a Promise.
  params: Promise<{ sessionId: string }>;
}) {
  const viewer = await requireStudioSession();

  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const { sessionId } = await params;

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseServiceRoleClient();
  const detail = await loadCashHistoryDetail(supabase, admin, sessionId);

  if (detail === null) {
    notFound();
  }

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
      <DetailView detail={detail} />
    </div>
  );
}
