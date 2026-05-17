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
  searchParams,
}: {
  // Next.js 16 App Router — params + searchParams are both Promises.
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
  const viewer = await requireStudioSession();

  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const { sessionId } = await params;
  const sp = (await searchParams) ?? {};
  const edit = sp.edit === "1";

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
      <DetailView detail={detail} edit={edit} />
    </div>
  );
}
