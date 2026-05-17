// lib/realtime/payments.ts
//
// CLIENT-ONLY browser helper. Wraps Supabase Realtime's `postgres_changes`
// channel for the `payments` table, scoped to a single ticket.
//
// Used by the card-waiting screen (T038) to advance to Done as soon as
// the webhook handler flips the row. The polling fallback in
// `/api/square/terminal-checkout/[id]` is the safety net for when the
// channel is delayed or dropped (research R5, R6).
//
// Cleanup contract (research R10 — non-negotiable): the function returns
// an `unsubscribe()` callback that removes the channel from the Supabase
// client's internal registry. Callers MUST invoke it on unmount/cancel/
// advance. The caller MUST NOT hold a reference to the raw channel —
// that's why we return a closure, not the channel object.

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

export type PaymentChangePayload = {
  /** The full updated row Supabase sends (or null for malformed events). */
  new: Partial<PaymentRow> | null;
};

/**
 * Subscribe to UPDATE events on `payments` filtered to a single ticket.
 *
 * @param ticketId  The ticket whose payment rows to watch.
 * @param callback  Fires for every UPDATE event on a matching row.
 * @returns         An `unsubscribe()` callback. MUST be invoked in the
 *                  caller's cleanup (React useEffect cleanup, etc).
 */
export function subscribePaymentChanges(
  ticketId: string,
  callback: (payload: PaymentChangePayload) => void
): () => void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.warn("subscribePaymentChanges: Supabase env vars missing — no realtime channel");
    return () => undefined;
  }

  const supabase = createBrowserClient<Database>(url, anonKey);

  // Channel name is scoped to the ticket so multiple open tabs don't
  // collide. Each subscriber gets a unique suffix so multiple useEffect
  // hooks in the same client island (e.g. card-waiting + split-mode
  // listeners) can coexist without tripping Supabase's "cannot add
  // postgres_changes after subscribe" guard.
  const subscriberId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const channel: RealtimeChannel = supabase
    .channel(`payments:ticket:${ticketId}:${subscriberId}`)
    .on(
      "postgres_changes" as never,
      {
        event: "UPDATE",
        schema: "public",
        table: "payments",
        filter: `ticket_id=eq.${ticketId}`,
      },
      (payload: unknown) => {
        const p = payload as { new?: Partial<PaymentRow> };
        callback({ new: p.new ?? null });
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
