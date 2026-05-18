// StatusDot — leading status indicator on a staff row (US5). Pure render.
// 8px dot with `--success` background when the staff is active, falling back
// to `--muted-foreground` when inactive. Radius 999 per Constitution I § 8
// (pills/chips). Every visible value resolves to a Lacquer token via the
// `.staff-status-dot[--active|--inactive]` CSS rules in `styles/settings.css`.

export type StatusDotProps = {
  active: boolean;
};

export function StatusDot({ active }: StatusDotProps) {
  return (
    <span
      className={
        active
          ? "staff-status-dot staff-status-dot--active"
          : "staff-status-dot staff-status-dot--inactive"
      }
      data-slot="staff-status-dot"
      data-active={active ? "true" : "false"}
      aria-hidden="true"
    />
  );
}
