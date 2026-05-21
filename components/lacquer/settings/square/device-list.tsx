"use client";

// components/lacquer/settings/square/device-list.tsx
//
// Client island — renders the list of paired Square Terminal devices for
// /settings/square. Each row exposes:
//   - friendly-name inline edit input (blur or Enter commits via
//     `renameDevice` Server Action).
//   - default radio (changes invoke `setDefaultDevice`).
//   - soft "last seen Xm ago" indicator (computed from `last_seen_at`).
//
// All values resolve to Lacquer tokens. Errors from server actions surface
// via the existing `sonner` toaster.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { renameDevice, setDefaultDevice } from "@/app/(studio)/settings/square/actions";

export type DeviceRow = {
  id: string;
  square_device_id: string;
  friendly_name: string;
  is_default: boolean;
  last_seen_at: string;
};

export type DeviceListProps = {
  devices: DeviceRow[];
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function DeviceList({ devices }: DeviceListProps) {
  if (devices.length === 0) {
    return (
      <Card>
        <CardContent
          style={{
            padding: "var(--space-6)",
            color: "var(--muted-foreground)",
            fontSize: "var(--text-sm)",
          }}
        >
          No Square Terminals visible yet. Pair a terminal in the Square Dashboard, then refresh.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent
        style={{
          padding: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-4) var(--space-6)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            Paired terminals
          </h3>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
            {devices.length} device{devices.length === 1 ? "" : "s"}
          </span>
        </header>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {devices.map((d) => (
            <DeviceRowItem key={d.id} device={d} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DeviceRowItem({ device }: { device: DeviceRow }) {
  const [name, setName] = useState(device.friendly_name);
  const [pending, startTransition] = useTransition();

  const commitName = (): void => {
    const next = name.trim();
    if (next.length === 0 || next.length > 60) {
      setName(device.friendly_name);
      toast.error("Name must be 1 to 60 characters.");
      return;
    }
    if (next === device.friendly_name) return;
    startTransition(async () => {
      try {
        await renameDevice(device.square_device_id, next);
        toast.success("Device renamed.");
      } catch (err) {
        setName(device.friendly_name);
        const msg = err instanceof Error ? err.message : "Could not rename device.";
        toast.error(msg);
      }
    });
  };

  const handleDefaultChange = (): void => {
    if (device.is_default) return;
    startTransition(async () => {
      try {
        await setDefaultDevice(device.square_device_id);
        toast.success("Default terminal updated.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not set default.";
        toast.error(msg);
      }
    });
  };

  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-4) var(--space-6)",
        borderBottom: "1px solid var(--border)",
      }}
      data-testid={`square-device-row-${device.square_device_id}`}
      aria-busy={pending || undefined}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0 }}>
        <Input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          disabled={pending}
          aria-label={`Friendly name for ${device.square_device_id}`}
          style={{ maxWidth: "calc(var(--space-16) * 5)" }}
        />
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {device.square_device_id} · last seen {formatRelative(device.last_seen_at)}
        </span>
      </div>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          fontSize: "var(--text-sm)",
          color: "var(--foreground)",
          cursor: "pointer",
        }}
      >
        <input
          type="radio"
          name="square-default-device"
          checked={device.is_default}
          onChange={handleDefaultChange}
          disabled={pending}
          data-testid={`square-device-default-${device.square_device_id}`}
        />
        Default
      </label>
      <span
        aria-hidden="true"
        style={{
          width: "var(--space-5)",
          height: "var(--space-5)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: pending
            ? "var(--muted-foreground)"
            : device.is_default
              ? "var(--primary)"
              : "transparent",
        }}
      >
        {pending ? (
          <Spinner size={16} strokeWidth={2} />
        ) : (
          <CheckCircle2 size={16} strokeWidth={1.5} />
        )}
      </span>
    </li>
  );
}
