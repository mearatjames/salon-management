"use client";

// CheckoutScreen — client island that wires the cart together.
//
// Owned state:
//   - `selectedStaffId` (header tech pick; the default for new lines)
//   - `lines` (cart contents, with optimistic temp ids)
//   - `paymentMethod` (cash | null in this phase)
//   - `errorBanner` (FR-019 user-recoverable failures)
//   - `inflight` (set during terminal actions to lock the buttons)
//   - `placeholderLine` (the cart line whose price control opened the
//      variable-price placeholder dialog; null when closed)
//
// Behaviour:
//   - `addServiceLine` and `removeLine` use optimistic UI (R9). Temp ids
//     get replaced with server-returned ids on success; on failure the
//     optimistic mutation is reverted and an error banner is surfaced.
//   - `takeCash` and `discardTicket` are terminal — they wait for the
//     server to confirm before navigating.
//
// Totals are re-derived from `computeTotals` each render. The server's
// `tickets.total_cents` is the authority — at charge time `pos_take_cash`
// reads it from the locked row, not from the client view.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addServiceLine,
  discardTicket,
  removeLine,
  setLineTech,
  takeCash,
} from "@/app/(studio)/checkout/actions";
import {
  CashPaymentFailedError,
  ServiceArchivedError,
  StaffNotActiveError,
  TicketAlreadyTerminalError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
  TicketNotOpenError,
} from "@/app/(studio)/checkout/_errors";

import {
  CartRowWithTech,
  type CartLineView,
} from "@/components/lacquer/checkout/cart-row-with-tech";
import { PaymentTiles, type PaymentMethod } from "@/components/lacquer/checkout/payment-tiles";
import { ServiceTiles, type ServiceTileService } from "@/components/lacquer/checkout/service-tiles";
import { TechAvatarRow } from "@/components/lacquer/checkout/tech-avatar-row";
import { Totals } from "@/components/lacquer/checkout/totals";
import { TxHeader } from "@/components/lacquer/checkout/tx-header";
import { VariablePricePlaceholderDialog } from "@/components/lacquer/checkout/variable-price-placeholder-dialog";

import { computeTotals } from "@/lib/pos/cart";

type Staff = { id: string; display_name: string; color_token: string };

export type CheckoutScreenProps = {
  ticketId: string;
  initialItems: CartLineView[];
  staff: Staff[];
  services: ServiceTileService[];
};

function tempId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function CheckoutScreen({ ticketId, initialItems, staff, services }: CheckoutScreenProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Header tech pick defaults to the first line's assigned staff if the
  // ticket was already non-empty when the page loaded; otherwise null.
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(
    initialItems[0]?.assignedStaffId ?? null
  );
  const [lines, setLines] = useState<CartLineView[]>(initialItems);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [inflight, setInflight] = useState(false);
  const [placeholderLineId, setPlaceholderLineId] = useState<string | null>(null);

  const staffById = useMemo(() => {
    const m = new Map<string, Staff>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l) => ({
          unitPriceCents: l.unitPriceCents,
          qty: l.qty,
          priceUnconfirmed: l.priceUnconfirmed,
        }))
      ),
    [lines]
  );

  const takeCashEnabled = !inflight && paymentMethod === "cash" && totals.chargeEligible;

  function handlePickTech(staffId: string) {
    setSelectedStaffId(staffId);
  }

  function handleClearTech() {
    setSelectedStaffId(null);
  }

  function handlePickService(svc: ServiceTileService) {
    if (!selectedStaffId) return;
    const tmp = tempId();
    const optimisticLine: CartLineView = {
      id: tmp,
      serviceId: svc.id,
      name: svc.name,
      unitPriceCents: svc.price_cents,
      qty: 1,
      priceUnconfirmed: svc.variable_price,
      assignedStaffId: selectedStaffId,
    };
    setLines((prev) => [...prev, optimisticLine]);
    setErrorBanner(null);

    startTransition(async () => {
      try {
        const { lineId } = await addServiceLine({
          ticketId,
          serviceId: svc.id,
          assignedStaffId: selectedStaffId,
        });
        // Swap the temp id for the server-returned one.
        setLines((prev) => prev.map((l) => (l.id === tmp ? { ...l, id: lineId } : l)));
      } catch (err) {
        // Revert the optimistic insert.
        setLines((prev) => prev.filter((l) => l.id !== tmp));
        if (err instanceof StaffNotActiveError) {
          setErrorBanner("That tech is no longer active. Pick another.");
        } else if (err instanceof ServiceArchivedError) {
          setErrorBanner("That service is no longer available.");
        } else if (err instanceof TicketNotOpenError) {
          setErrorBanner("This ticket is no longer open.");
        } else {
          setErrorBanner("Couldn’t add that service. Try again.");
        }
      }
    });
  }

  function handleRemoveLine(line: CartLineView) {
    const snapshot = lines;
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    setErrorBanner(null);

    // Skip the round-trip for optimistic-only temp lines (the server
    // never saw them).
    if (line.id.startsWith("tmp-")) return;

    startTransition(async () => {
      try {
        await removeLine({ ticketId, lineId: line.id });
      } catch (err) {
        // Revert.
        setLines(snapshot);
        if (err instanceof TicketNotOpenError) {
          setErrorBanner("This ticket is no longer open.");
        } else {
          setErrorBanner("Couldn’t remove that line. Try again.");
        }
      }
    });
  }

  function handleSetLineTech(line: CartLineView, newStaffId: string) {
    if (newStaffId === line.assignedStaffId) return;
    const previousStaffId = line.assignedStaffId;

    // Optimistic chip update.
    setLines((prev) =>
      prev.map((l) => (l.id === line.id ? { ...l, assignedStaffId: newStaffId } : l))
    );
    setErrorBanner(null);

    // Skip the round-trip for optimistic-only temp lines (the server has
    // not yet seen the row; the eventual addServiceLine insert will carry
    // the latest selectedStaffId, not this override).
    if (line.id.startsWith("tmp-")) return;

    startTransition(async () => {
      try {
        await setLineTech({
          ticketId,
          lineId: line.id,
          assignedStaffId: newStaffId,
        });
      } catch (err) {
        // Snap back to the previous assignment.
        setLines((prev) =>
          prev.map((l) => (l.id === line.id ? { ...l, assignedStaffId: previousStaffId } : l))
        );
        if (err instanceof StaffNotActiveError) {
          setErrorBanner("That tech is no longer active. Pick another.");
        } else if (err instanceof TicketNotOpenError) {
          setErrorBanner("This ticket is no longer open.");
        } else {
          setErrorBanner("Couldn’t change tech. Try again.");
        }
      }
    });
  }

  function handleEditPrice(line: CartLineView) {
    // FR-016: unconfirmed-price lines open the placeholder dialog. For
    // fixed-price lines the price control is a no-op in this phase
    // (later phase adds discount-edit).
    if (!line.priceUnconfirmed) return;
    setPlaceholderLineId(line.id);
  }

  function handlePlaceholderRemove() {
    const line = lines.find((l) => l.id === placeholderLineId);
    if (line) handleRemoveLine(line);
    setPlaceholderLineId(null);
  }

  async function handleTakeCash() {
    if (!takeCashEnabled || inflight) return;
    setInflight(true);
    setErrorBanner(null);
    try {
      await takeCash({ ticketId });
      router.refresh();
    } catch (err) {
      if (err instanceof TicketHasUnpricedItemsError) {
        setErrorBanner("Set price on highlighted items before charging.");
      } else if (err instanceof TicketNotOpenError) {
        setErrorBanner("This ticket is no longer open.");
      } else if (err instanceof TicketEmptyError) {
        setErrorBanner("Add at least one priced line before charging.");
      } else if (err instanceof CashPaymentFailedError) {
        setErrorBanner("Cash payment didn’t save — try again.");
      } else {
        setErrorBanner("Couldn’t take cash. Try again.");
      }
    } finally {
      setInflight(false);
    }
  }

  async function handleDiscard() {
    if (inflight) return;
    setInflight(true);
    setErrorBanner(null);
    try {
      await discardTicket({ ticketId });
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof TicketAlreadyTerminalError) {
        setErrorBanner("This ticket was already closed.");
      } else {
        setErrorBanner("Couldn’t discard. Try again.");
      }
    } finally {
      setInflight(false);
    }
  }

  function handleCancel() {
    router.push("/dashboard");
  }

  const placeholderLine = placeholderLineId
    ? (lines.find((l) => l.id === placeholderLineId) ?? null)
    : null;

  return (
    <div className="checkout-shell" data-slot="checkout-shell" data-ticket-id={ticketId}>
      <TxHeader
        subtitle="Walk-in"
        onCancel={handleCancel}
        onDiscard={handleDiscard}
        disabled={inflight}
      />
      <div className="checkout-body">
        {/* LEFT: cart column */}
        <section className="checkout-cart" aria-label="Cart">
          <TechAvatarRow
            staff={staff}
            selectedStaffId={selectedStaffId}
            onPick={handlePickTech}
            onClear={handleClearTech}
          />
          <div className="checkout-cart-lines" data-slot="checkout-cart-lines">
            {lines.length === 0 ? (
              <p
                data-slot="checkout-cart-empty"
                style={{
                  margin: 0,
                  padding: "var(--space-6) 0",
                  fontSize: "var(--text-sm)",
                  color: "var(--muted-foreground)",
                  textAlign: "center",
                }}
              >
                {selectedStaffId
                  ? "Tap a service to start."
                  : "Pick a tech first, then tap a service."}
              </p>
            ) : (
              lines.map((line) => (
                <CartRowWithTech
                  key={line.id}
                  line={line}
                  staffById={staffById}
                  onRemove={() => handleRemoveLine(line)}
                  onEditPrice={() => handleEditPrice(line)}
                  onSetTech={(staffId) => handleSetLineTech(line, staffId)}
                />
              ))
            )}
          </div>
          <Totals
            subtotalCents={totals.subtotalCents}
            taxCents={totals.taxCents}
            totalCents={totals.totalCents}
          />
          {errorBanner ? (
            <p
              role="alert"
              data-slot="checkout-error-banner"
              style={{
                margin: 0,
                padding: "var(--space-2) var(--space-3)",
                background: "color-mix(in oklch, var(--destructive) 10%, transparent)",
                border: "1px solid var(--destructive)",
                borderRadius: "var(--radius-sm)",
                color: "var(--destructive)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
              }}
            >
              {errorBanner}
            </p>
          ) : null}
          <PaymentTiles value={paymentMethod} onChange={setPaymentMethod} />
          <button
            type="button"
            onClick={handleTakeCash}
            disabled={!takeCashEnabled}
            data-slot="take-cash-button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: "var(--space-10)",
              padding: "0 var(--space-4)",
              background: takeCashEnabled ? "var(--primary)" : "var(--muted)",
              color: takeCashEnabled ? "var(--primary-foreground)" : "var(--muted-foreground)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-base)",
              fontWeight: 600,
              cursor: takeCashEnabled ? "pointer" : "not-allowed",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {totals.totalCents > 0 && !totals.chargeEligible
              ? "Set price on highlighted items"
              : `Take cash · ${fmt(totals.totalCents)}`}
          </button>
        </section>

        {/* RIGHT: catalog column */}
        <section className="checkout-catalog" aria-label="Service catalog">
          <ServiceTiles
            services={services}
            disabled={!selectedStaffId}
            onPick={handlePickService}
          />
        </section>
      </div>

      <VariablePricePlaceholderDialog
        open={placeholderLine !== null}
        onOpenChange={(open) => (open ? null : setPlaceholderLineId(null))}
        serviceName={placeholderLine?.name ?? ""}
        onRemove={handlePlaceholderRemove}
      />
    </div>
  );
}
