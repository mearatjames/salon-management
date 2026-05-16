// /checkout entry page. Server Component.
//
// Dispatches by entry-point hint (T034 / US2 / FR-002 + FR-003):
//   - `?fresh=1`  → dashboard CTA path; always creates a brand-new ticket.
//   - no query    → sidebar path; resumes the operator's same-day open
//                   ticket if one exists, otherwise creates a fresh one.
//
// Both paths redirect to `/checkout/[ticketId]` server-side.
//
// Next 16 makes `searchParams` a Promise — must be awaited.

import { redirect } from "next/navigation";

import { createEmptyTicket, resumeOrCreateTicket } from "./actions";

export const dynamic = "force-dynamic";

export default async function CheckoutEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ fresh?: string }>;
}) {
  const params = await searchParams;
  if (params.fresh === "1") {
    const { ticketId } = await createEmptyTicket("dashboard_cta");
    redirect(`/checkout/${ticketId}`);
  }
  const { ticketId } = await resumeOrCreateTicket();
  redirect(`/checkout/${ticketId}`);
}
