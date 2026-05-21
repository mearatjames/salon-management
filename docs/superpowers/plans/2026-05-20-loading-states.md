# Loading & Processing States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page-load, button, section, and processing loading states across every Tang Nails surface that needs them, all traced to the design system's canonical patterns.

**Architecture:** Build three shared primitives — `<Spinner>`, `<Skeleton>`, `<SubmitButton>` — plus a `loading` prop on the shadcn `Button`, then roll them out: migrate the 4 existing skeletons to the canonical shimmer, add ~11 new `loading.tsx` files, wire pending states into auth/staff/checkout buttons, and add a visible processing state to the PIN modal.

**Tech Stack:** Next.js 16 App Router, React 19 (`useFormStatus`, `useTransition`), Tailwind v4, Lucide icons, Vitest + @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-20-loading-states-design.md`
**Design reference:** `design-system/preview/loading.html` (canonical loading patterns).

---

## Conventions

- **Branch:** all work on `fix/ui-fixes` (already checked out). One PR at the end.
- **Commits:** conventional (`feat:`, `refactor:`, `style:`), one per task. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- **Design fidelity (NON-NEGOTIABLE):** every color/spacing/radius/type value resolves to a `var(--*)` token from `styles/tokens.css`. No raw hex, no off-scale numbers. Compare output against `design-system/preview/loading.html`.
- **Tokens used in this plan:** `--muted`, `--neutral-300`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--border`, `--radius-xs` (4px), `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (12px), `--radius-full` (9999px).

## Testing strategy

- **Tasks 1–5 (primitives):** real TDD. Unit tests under `tests/unit/ui/*.test.tsx` (the Vitest `components` project globs `tests/unit/**/*.test.tsx`, jsdom env).
- **Tasks 6–10 (`loading.tsx` skeletons):** presentational, no behavior — no unit tests. Verified by `npm run typecheck`, `npm run lint`, and that the route still renders (existing e2e). A theatrical "renders a div" test adds no value.
- **Tasks 11–17 (component edits):** the pending state is driven by `useFormStatus`/`useTransition` and cannot be triggered meaningfully in jsdom without a live server action. Verified by typecheck/lint, by keeping existing e2e green, and by the e2e additions in Task 18. Where an edit changes a component that already has a unit test, keep that test green.
- **Task 18:** full gate set.

---

## Phase 1 — Shared primitives

### Task 1: Loading stylesheet

**Files:**
- Create: `styles/loading.css`

- [ ] **Step 1: Create the stylesheet**

Create `styles/loading.css`:

```css
/* Loading-state animations — shared by <Spinner> and <Skeleton>.
   Canonical reference: design-system/preview/loading.html.
   Every value traces to a token (Constitution Principle I). */

/* Spinner — Lucide Loader2 arc, 1.2s linear (matches the
   reconnecting-banner cadence). */
@keyframes lq-spin {
  to {
    transform: rotate(360deg);
  }
}

.lq-spinner {
  animation: lq-spin 1.2s linear infinite;
  display: block;
  flex-shrink: 0;
}

/* Skeleton — horizontal shimmer sweep. More premium than an opacity
   pulse (design-system/preview/loading.html). Base --muted, highlight
   --neutral-300; the 1200px background-size gives a smooth cross-fade. */
@keyframes lq-shimmer {
  0% {
    background-position: -600px 0;
  }
  100% {
    background-position: 600px 0;
  }
}

.lq-skeleton {
  background: linear-gradient(
    90deg,
    var(--muted) 0%,
    var(--neutral-300) 45%,
    var(--muted) 80%
  );
  background-size: 1200px 100%;
  animation: lq-shimmer 1.6s ease-in-out infinite;
}

/* Respect reduced-motion: hold a static muted fill / slow the spinner. */
@media (prefers-reduced-motion: reduce) {
  .lq-spinner {
    animation-duration: 2.4s;
  }
  .lq-skeleton {
    animation: none;
    background: var(--muted);
  }
}
```

- [ ] **Step 2: Verify Prettier accepts it**

Run: `npx prettier --check styles/loading.css`
Expected: no output / "All matched files use Prettier code style!" (run `npx prettier --write styles/loading.css` if it complains).

- [ ] **Step 3: Commit**

```bash
git add styles/loading.css
git commit -m "$(cat <<'EOF'
feat: add shared loading-state stylesheet

Canonical lq-spin / lq-shimmer keyframes from the design system's
loading.html, with a prefers-reduced-motion fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `<Spinner>` primitive

**Files:**
- Create: `components/ui/spinner.tsx`
- Test: `tests/unit/ui/spinner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/spinner.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Spinner } from "@/components/ui/spinner";

afterEach(() => {
  cleanup();
});

describe("<Spinner />", () => {
  it("renders an svg with the lq-spinner animation class", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass("lq-spinner");
  });

  it("defaults to a 16px icon and is hidden from assistive tech", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders at the requested size", () => {
    const { container } = render(<Spinner size={24} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "24");
  });

  it("merges an extra className", () => {
    const { container } = render(<Spinner className="extra" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("lq-spinner");
    expect(svg).toHaveClass("extra");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/spinner.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/spinner`.

- [ ] **Step 3: Implement `<Spinner>`**

Create `components/ui/spinner.tsx`:

```tsx
// Spinner — the canonical Lacquer loading spinner.
//
// Lucide Loader2 (the arc icon) spun by the `lq-spin` keyframe (1.2s
// linear). Canonical reference: design-system/preview/loading.html.
// Sizes mirror Lucide's icon scale (16 / 20 / 24); stroke is heavier at
// 16 so the thin arc stays visible. `aria-hidden` — the SURROUNDING
// container owns any accessible status text (role="status" / a label).

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import "@/styles/loading.css";

const STROKE_FOR_SIZE: Record<16 | 20 | 24, number> = {
  16: 1.8,
  20: 1.5,
  24: 1.5,
};

export type SpinnerProps = {
  /** Icon size in px — matches Lucide's 16 / 20 / 24 scale. */
  size?: 16 | 20 | 24;
  /** Override the size-derived stroke width (e.g. 2 inside a button). */
  strokeWidth?: number;
  className?: string;
};

export function Spinner({ size = 16, strokeWidth, className }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      strokeWidth={strokeWidth ?? STROKE_FOR_SIZE[size]}
      aria-hidden="true"
      className={cn("lq-spinner", className)}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/spinner.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/spinner.tsx tests/unit/ui/spinner.test.tsx
git commit -m "$(cat <<'EOF'
feat: add <Spinner> loading primitive

Lucide Loader2 on the lq-spin keyframe — the canonical Lacquer
spinner per design-system/preview/loading.html.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `<Skeleton>` primitive

**Files:**
- Create: `components/ui/skeleton.tsx`
- Test: `tests/unit/ui/skeleton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/skeleton.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { Skeleton } from "@/components/ui/skeleton";

afterEach(() => {
  cleanup();
});

describe("<Skeleton />", () => {
  it("renders a shimmer block hidden from assistive tech", () => {
    const { container } = render(<Skeleton width={120} height={12} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass("lq-skeleton");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("applies width, height and the default radius", () => {
    const { container } = render(<Skeleton width={120} height={12} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("12px");
    expect(el.style.borderRadius).toBe("var(--radius-xs)");
  });

  it("honours a custom radius and merged style", () => {
    const { container } = render(
      <Skeleton width={40} height={40} radius="var(--radius-full)" style={{ marginTop: 8 }} />
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.borderRadius).toBe("var(--radius-full)");
    expect(el.style.marginTop).toBe("8px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/skeleton.test.tsx`
Expected: FAIL — cannot resolve `@/components/ui/skeleton`.

- [ ] **Step 3: Implement `<Skeleton>`**

Create `components/ui/skeleton.tsx`:

```tsx
// Skeleton — a single shimmer placeholder block.
//
// The shimmer animation lives in `styles/loading.css` (`.lq-skeleton`);
// this component is just the sized box. Compose many of them inside a
// route `loading.tsx` to mirror that page's chrome so real content
// arrives with zero layout shift. Canonical reference:
// design-system/preview/loading.html.
//
// `aria-hidden` — a skeleton conveys nothing to assistive tech; the
// route transition itself is the signal.

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import "@/styles/loading.css";

export type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  /** Border radius — a token reference. Defaults to --radius-xs. */
  radius?: string;
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({
  width,
  height,
  radius = "var(--radius-xs)",
  className,
  style,
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("lq-skeleton", className)}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/skeleton.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ui/skeleton.tsx tests/unit/ui/skeleton.test.tsx
git commit -m "$(cat <<'EOF'
feat: add <Skeleton> loading primitive

Shimmer placeholder block (lq-shimmer) per the design system's
loading.html — the building block for route loading.tsx skeletons.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `loading` prop on `<Button>`

**Files:**
- Modify: `components/ui/button.tsx`
- Test: `tests/unit/ui/button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/button.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

afterEach(() => {
  cleanup();
});

describe("<Button loading>", () => {
  it("renders no spinner when not loading", () => {
    const { container } = render(<Button>Save</Button>);
    expect(container.querySelector(".lq-spinner")).toBeNull();
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("renders a spinner, disables, and marks aria-busy when loading", () => {
    const { container } = render(<Button loading>Save</Button>);
    expect(container.querySelector(".lq-spinner")).not.toBeNull();
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("data-loading", "true");
  });

  it("keeps its children visible while loading (caller swaps the label)", () => {
    render(<Button loading>Saving…</Button>);
    expect(screen.getByRole("button")).toHaveTextContent("Saving…");
  });

  it("stays disabled when disabled is passed without loading", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/button.test.tsx`
Expected: FAIL — no `.lq-spinner` rendered, no `aria-busy`.

- [ ] **Step 3: Implement the `loading` prop**

In `components/ui/button.tsx`, add the import at the top (after the existing imports):

```tsx
import { Spinner } from "@/components/ui/spinner";
```

Replace the entire `Button` function with:

```tsx
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  style,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** When true: disabled + aria-busy, prepends a <Spinner>, and uses
     *  the design system's 0.72 loading opacity. Not supported with
     *  asChild (Slot accepts a single child). */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      // Inline style beats the cva `disabled:opacity-50` utility, so the
      // loading state lands on the design system's exact 0.72 opacity.
      style={loading ? { opacity: 0.72, ...style } : style}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && !asChild ? <Spinner size={16} strokeWidth={2} /> : null}
      {children}
    </Comp>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/button.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing button consumers' tests**

Run: `npx vitest run tests/unit/square tests/unit/staff`
Expected: PASS — the new optional prop is backward compatible.

- [ ] **Step 6: Commit**

```bash
git add components/ui/button.tsx tests/unit/ui/button.test.tsx
git commit -m "$(cat <<'EOF'
feat: add loading prop to <Button>

Loading renders a leading <Spinner>, disables, sets aria-busy, and
applies the design system's 0.72 loading opacity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `<SubmitButton>` primitive

A chrome-agnostic submit button: it renders a plain `<button type="submit">`, reads `useFormStatus()`, and on pending disables itself + prepends a `<Spinner>` + swaps to a pending label. The caller passes the existing `className`/`style` so each form keeps its current chrome (auth `.auth-btn`, staff inline styles, etc.).

**Files:**
- Create: `components/lacquer/submit-button.tsx`
- Test: `tests/unit/ui/submit-button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/submit-button.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SubmitButton } from "@/components/lacquer/submit-button";

afterEach(() => {
  cleanup();
});

// useFormStatus() reports pending=false outside a submitting form, so the
// unit test covers the idle contract; the pending visual is exercised by
// the Task 18 e2e additions.
describe("<SubmitButton />", () => {
  it("renders a type=submit button with the idle children", () => {
    render(
      <form>
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </form>
    );
    const btn = screen.getByRole("button", { name: "Save changes" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).not.toBeDisabled();
  });

  it("forwards className and data-slot to the button", () => {
    render(
      <form>
        <SubmitButton pendingLabel="Saving…" className="auth-btn" data-slot="x">
          Save
        </SubmitButton>
      </form>
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("auth-btn");
    expect(btn).toHaveAttribute("data-slot", "x");
  });

  it("renders no spinner while idle", () => {
    const { container } = render(
      <form>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </form>
    );
    expect(container.querySelector(".lq-spinner")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ui/submit-button.test.tsx`
Expected: FAIL — cannot resolve `@/components/lacquer/submit-button`.

- [ ] **Step 3: Implement `<SubmitButton>`**

Create `components/lacquer/submit-button.tsx`:

```tsx
"use client";

// SubmitButton — a form submit button with a built-in pending state.
//
// Reads React's `useFormStatus()`, so it MUST be rendered inside the
// `<form action={…}>` whose submission it reflects (the hook reads the
// nearest enclosing form's status). While that form's Server Action is
// in flight it disables itself, prepends a <Spinner>, and swaps to
// `pendingLabel`.
//
// Chrome-agnostic: it renders a plain <button> and forwards `className`
// / `style` verbatim, so each form keeps its existing visual treatment
// (auth `.auth-btn`, staff inline styles, …). Pending styling is the
// design system's 0.72 opacity via inline style.

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Spinner } from "@/components/ui/spinner";

export type SubmitButtonProps = Omit<ComponentProps<"button">, "type" | "children"> & {
  /** Content shown while idle. */
  children: ReactNode;
  /** Label shown (next to the spinner) while the form is submitting. */
  pendingLabel: string;
};

export function SubmitButton({
  children,
  pendingLabel,
  className,
  style,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-loading={pending || undefined}
      className={className}
      style={pending ? { opacity: 0.72, ...style } : style}
      {...props}
    >
      {pending ? (
        <>
          <Spinner size={16} strokeWidth={2} />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ui/submit-button.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/lacquer/submit-button.tsx tests/unit/ui/submit-button.test.tsx
git commit -m "$(cat <<'EOF'
feat: add <SubmitButton> with built-in form pending state

Chrome-agnostic submit button — reads useFormStatus, disables and
shows a spinner + pending label while the form's action runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Page-load skeletons

### Task 6: Migrate the 4 existing skeletons to shimmer

Replace the `.tx-skeleton` pulse with `<Skeleton>` in all four existing `loading.tsx` files, then delete the now-dead pulse CSS. The transformation is mechanical and identical for every placeholder:

`<div className="tx-skeleton" style={{ ...placeholder, width: W, height: H, borderRadius: R, marginTop: M }} />`
→ `<Skeleton width={W} height={H} radius={<R as a token>} style={{ marginTop: M }} />`

Map the literal radius numbers to tokens: `8` → `"var(--radius-md)"`, `12` → `"var(--radius-lg)"`, `6` → `"var(--radius-sm)"`, `10` → `"var(--radius-lg)"` (nearest), `9999` → `"var(--radius-full)"`. When the original had no explicit `borderRadius` (only the `placeholder` default of `8`), pass `radius="var(--radius-md)"`. Drop the `placeholder` const entirely. Keep all layout wrappers, `data-slot` attributes, comments-worth-keeping, and the page-chrome class names unchanged.

**Files:**
- Modify: `app/(studio)/dashboard/loading.tsx`
- Modify: `app/(studio)/transactions/loading.tsx`
- Modify: `app/(studio)/report/loading.tsx`
- Modify: `app/(studio)/payroll/loading.tsx`
- Modify: `styles/dashboard.css`

- [ ] **Step 1: Migrate `dashboard/loading.tsx`**

- Add `import { Skeleton } from "@/components/ui/skeleton";`.
- Keep `import "@/styles/dashboard.css";` (it supplies the `.tx-landing` / `.tx-stat-card` / `.tx-feed` layout classes — only the `.tx-skeleton` reliance goes away).
- Delete the `placeholder` const.
- Replace every `<div className="tx-skeleton" … />` with `<Skeleton … />` per the transformation above.
- Update the file's header comment: the placeholders now use the shimmer `<Skeleton>` primitive (`styles/loading.css`); drop the paragraph defending the 1500ms pulse.

- [ ] **Step 2: Migrate `transactions/loading.tsx`**

Same transformation. **Remove** `import "@/styles/dashboard.css";` — after migration this file no longer needs anything from it (it kept it only for `.tx-skeleton`). Keep `import "@/styles/transactions.css";`. Update the header comment (drop the pulse paragraph).

- [ ] **Step 3: Migrate `report/loading.tsx`**

Same transformation. **Remove** `import "@/styles/dashboard.css";`. Keep `import "@/styles/report.css";`. Update the header comment.

- [ ] **Step 4: Migrate `payroll/loading.tsx`**

Same transformation. **Remove** `import "@/styles/dashboard.css";`. Keep `import "@/styles/payroll.css";`. Update the header comment.

- [ ] **Step 5: Delete the dead pulse CSS**

In `styles/dashboard.css`, delete the entire "Loading-state pulse" section — the `/* ---------- Loading-state pulse ---------- */` comment, the `@keyframes tx-skeleton-pulse` block, and the `.tx-skeleton` rule (around lines 417–433). Leave the `/* ---------- Utilities ---------- */` section and everything else intact.

- [ ] **Step 6: Verify no remaining `tx-skeleton` references**

Run: `grep -rn "tx-skeleton" app/ components/ styles/`
Expected: no output. If anything remains, migrate it too.

- [ ] **Step 7: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint app/\(studio\)/dashboard/loading.tsx app/\(studio\)/transactions/loading.tsx app/\(studio\)/report/loading.tsx app/\(studio\)/payroll/loading.tsx && npx prettier --check "app/(studio)/**/loading.tsx" styles/dashboard.css`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add "app/(studio)/dashboard/loading.tsx" "app/(studio)/transactions/loading.tsx" "app/(studio)/report/loading.tsx" "app/(studio)/payroll/loading.tsx" styles/dashboard.css
git commit -m "$(cat <<'EOF'
refactor: migrate route skeletons from pulse to shimmer

Dashboard / transactions / report / payroll loading.tsx now use the
canonical <Skeleton> shimmer; the dead tx-skeleton pulse is removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: New `loading.tsx` — select-staff & checkout

Each new `loading.tsx` mirrors its page's chrome so content arrives with zero layout shift — the same approach the 4 migrated files use. **For each page below: first read the page component and its CSS to learn the chrome, then compose `<Skeleton>` blocks inside the real layout wrappers (reuse the page's own class names so spacing matches).** Use the migrated `app/(studio)/transactions/loading.tsx` as the reference for structure and import style.

**Files:**
- Create: `app/(device)/select-staff/loading.tsx`
- Create: `app/(studio)/checkout/loading.tsx`
- Create: `app/(studio)/checkout/[ticketId]/loading.tsx`

- [ ] **Step 1: `select-staff/loading.tsx`**

Read `app/(device)/select-staff/page.tsx` and `styles/select-staff.css`. Build a skeleton that mirrors the select-staff screen: the header/eyebrow band and the avatar tile grid. Render ~6–8 tile placeholders — each tile is a circular `<Skeleton radius="var(--radius-full)">` for the avatar plus a short `<Skeleton>` line for the name. Wrap in the page's own grid/container classes. Add `import "@/styles/select-staff.css";`.

- [ ] **Step 2: `checkout/loading.tsx`**

Read `app/(studio)/checkout/page.tsx`, `app/(studio)/checkout/checkout-screen.client.tsx` (top-level layout only), and the checkout CSS. Build a skeleton mirroring the checkout two-panel chrome: the staff/service picker column and the cart/summary column. Use `<Skeleton>` rows for list items and a taller block for the charge footer. Import the checkout stylesheet.

- [ ] **Step 3: `checkout/[ticketId]/loading.tsx`**

The `[ticketId]` route renders the same checkout screen for an existing ticket. Reuse the exact structure from Step 2 (a near-identical skeleton is correct here — both render the checkout shell). Create the file with the same chrome.

- [ ] **Step 4: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint "app/(device)/select-staff/loading.tsx" "app/(studio)/checkout/loading.tsx" "app/(studio)/checkout/[ticketId]/loading.tsx" && npx prettier --check "app/(device)/select-staff/loading.tsx" "app/(studio)/checkout/loading.tsx" "app/(studio)/checkout/[ticketId]/loading.tsx"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "app/(device)/select-staff/loading.tsx" "app/(studio)/checkout/loading.tsx" "app/(studio)/checkout/[ticketId]/loading.tsx"
git commit -m "$(cat <<'EOF'
feat: add loading skeletons for select-staff and checkout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: New `loading.tsx` — end-of-day

**Files:**
- Create: `app/(studio)/end-of-day/loading.tsx`
- Create: `app/(studio)/end-of-day/history/loading.tsx`
- Create: `app/(studio)/end-of-day/history/[sessionId]/loading.tsx`

- [ ] **Step 1: `end-of-day/loading.tsx`**

Read `app/(studio)/end-of-day/page.tsx` and its CSS. Mirror the cash-count chrome: header band, the cash total/summary block, and the count form / numpad area. Compose `<Skeleton>` blocks inside the page's layout wrappers.

- [ ] **Step 2: `end-of-day/history/loading.tsx`**

Read `app/(studio)/end-of-day/history/page.tsx`. Mirror the history list chrome: header band + a list of ~6 session-row `<Skeleton>` blocks.

- [ ] **Step 3: `end-of-day/history/[sessionId]/loading.tsx`**

Read `app/(studio)/end-of-day/history/[sessionId]/page.tsx`. Mirror the session-detail chrome: header band, summary block, and a denomination/line table of `<Skeleton>` rows.

- [ ] **Step 4: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint "app/(studio)/end-of-day/loading.tsx" "app/(studio)/end-of-day/history/loading.tsx" "app/(studio)/end-of-day/history/[sessionId]/loading.tsx" && npx prettier --check "app/(studio)/end-of-day/loading.tsx" "app/(studio)/end-of-day/history/loading.tsx" "app/(studio)/end-of-day/history/[sessionId]/loading.tsx"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "app/(studio)/end-of-day/loading.tsx" "app/(studio)/end-of-day/history/loading.tsx" "app/(studio)/end-of-day/history/[sessionId]/loading.tsx"
git commit -m "$(cat <<'EOF'
feat: add loading skeletons for end-of-day surfaces

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: New `loading.tsx` — payroll detail & services

**Files:**
- Create: `app/(studio)/payroll/[staffId]/loading.tsx`
- Create: `app/(studio)/services/loading.tsx`

- [ ] **Step 1: `payroll/[staffId]/loading.tsx`**

Read `app/(studio)/payroll/[staffId]/page.tsx` and `styles/payroll.css`. Mirror the tech-detail chrome: header band, the per-tech summary tiles, and the detail ledger table of `<Skeleton>` rows. The migrated `app/(studio)/payroll/loading.tsx` is a close structural cousin — follow its pattern.

- [ ] **Step 2: `services/loading.tsx`**

Read `app/(studio)/services/page.tsx` and `styles/services.css` (or wherever the services chrome is styled). Mirror the catalog chrome: header band with the action button, and the grouped service list — a few group headers each with ~3–4 service-row `<Skeleton>` blocks.

- [ ] **Step 3: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint "app/(studio)/payroll/[staffId]/loading.tsx" "app/(studio)/services/loading.tsx" && npx prettier --check "app/(studio)/payroll/[staffId]/loading.tsx" "app/(studio)/services/loading.tsx"`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "app/(studio)/payroll/[staffId]/loading.tsx" "app/(studio)/services/loading.tsx"
git commit -m "$(cat <<'EOF'
feat: add loading skeletons for payroll detail and services

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: New `loading.tsx` — settings sub-pages

**Files:**
- Create: `app/(studio)/settings/onboarding/loading.tsx`
- Create: `app/(studio)/settings/square/loading.tsx`
- Create: `app/(studio)/settings/staff/loading.tsx`
- Possibly create: `loading.tsx` under `settings/general`, `settings/billing`, `settings/notifications`, `settings/policy`

- [ ] **Step 1: `settings/onboarding/loading.tsx`**

Read `app/(studio)/settings/onboarding/page.tsx` and `styles/onboarding.css`. Mirror the chrome: header band, the search input row, and a list of ~6 user-row `<Skeleton>` blocks.

- [ ] **Step 2: `settings/square/loading.tsx`**

Read `app/(studio)/settings/square/page.tsx`. Mirror the chrome: header band, the connection-status card, and a device-list block of ~3 `<Skeleton>` rows.

- [ ] **Step 3: `settings/staff/loading.tsx`**

Read `app/(studio)/settings/staff/page.tsx`. Mirror the chrome: header band, filter chips row, and the staff roster table of ~6 `<Skeleton>` rows.

- [ ] **Step 4: Check the remaining settings sub-pages**

For each of `settings/general/page.tsx`, `settings/billing/page.tsx`, `settings/notifications/page.tsx`, `settings/policy/page.tsx`: read the page. **If** it is an async Server Component that awaits a data fetch, create a matching `loading.tsx` mirroring its chrome. **If** it is a static stub (no `await` of data), skip it — note which were skipped in the commit body.

- [ ] **Step 5: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint "app/(studio)/settings/**/loading.tsx" && npx prettier --check "app/(studio)/settings/**/loading.tsx"`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "app/(studio)/settings"
git commit -m "$(cat <<'EOF'
feat: add loading skeletons for settings sub-pages

Onboarding, Square, and staff settings; static settings stubs are
left without a skeleton (no data fetch to mask).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Button / action states

### Task 11: Auth form submit buttons

Wire every auth form's submit button to `<SubmitButton>` so it shows a spinner + pending label while its Server Action runs. The auth submit buttons are raw `<button className="auth-btn …">` elements — `<SubmitButton>` keeps that exact chrome (pass the same `className`).

**Files:**
- Modify: `components/lacquer/reset-password-form.tsx`
- Modify: `components/lacquer/auth-views.tsx`
- Modify: `components/lacquer/google-sign-in-button.tsx`

- [ ] **Step 1: `reset-password-form.tsx`**

Add `import { SubmitButton } from "@/components/lacquer/submit-button";`. Replace:

```tsx
          <button type="submit" className="auth-btn auth-btn-primary">
            {submitLabel}
          </button>
```

with:

```tsx
          <SubmitButton
            className="auth-btn auth-btn-primary"
            pendingLabel={isInvite ? "Setting password…" : "Updating…"}
          >
            {submitLabel}
          </SubmitButton>
```

- [ ] **Step 2: `auth-views.tsx`**

Read the file. It contains three forms — `SignInView`, `ForgotView`, `MagicView` — each with a `<form action={…}>` and a raw `auth-btn auth-btn-primary` submit button. Add the `SubmitButton` import. For each, replace the raw submit `<button>` with `<SubmitButton>`, keeping the existing `className` and any `data-slot`/`data-testid`, and using these pending labels:
- SignInView → `pendingLabel="Signing in…"`
- ForgotView → `pendingLabel="Sending…"`
- MagicView → `pendingLabel="Sending…"`

Keep each button's existing idle text as the `children`.

- [ ] **Step 3: `google-sign-in-button.tsx`**

This is a Server Component; `<SubmitButton>` (a Client Component) renders fine inside its `<form>`. Add `import { SubmitButton } from "@/components/lacquer/submit-button";`. Replace:

```tsx
      <button
        type="submit"
        className="auth-btn auth-btn-outline"
        data-slot="google-sign-in"
        style={{ gap: "var(--space-3)" }}
      >
        <GoogleIcon />
        Continue with Google
      </button>
```

with:

```tsx
      <SubmitButton
        className="auth-btn auth-btn-outline"
        data-slot="google-sign-in"
        style={{ gap: "var(--space-3)" }}
        pendingLabel="Connecting…"
      >
        <GoogleIcon />
        Continue with Google
      </SubmitButton>
```

- [ ] **Step 4: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint components/lacquer/reset-password-form.tsx components/lacquer/auth-views.tsx components/lacquer/google-sign-in-button.tsx && npx prettier --check components/lacquer/reset-password-form.tsx components/lacquer/auth-views.tsx components/lacquer/google-sign-in-button.tsx`
Expected: all pass.

- [ ] **Step 5: Run auth unit tests**

Run: `npx vitest run tests/unit/auth`
Expected: PASS — keep any failures green by adjusting selectors only if a test asserted the old raw `<button>`.

- [ ] **Step 6: Commit**

```bash
git add components/lacquer/reset-password-form.tsx components/lacquer/auth-views.tsx components/lacquer/google-sign-in-button.tsx
git commit -m "$(cat <<'EOF'
feat: add pending states to auth form submit buttons

Sign-in, forgot-password, magic-link, password-reset and Google
buttons now show a spinner + pending label while their action runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Staff form submit buttons

**Files:**
- Modify: `components/lacquer/staff/edit-panel.client.tsx`
- Modify: `components/lacquer/staff/add-staff-wizard.client.tsx`
- Modify: `components/lacquer/staff/danger-zone.client.tsx`
- Modify: `components/lacquer/staff/change-pin-modal.client.tsx`

For each file: read it, find the `<button type="submit">` inside the `<form action={…}>`, and replace it with `<SubmitButton>` — keeping the existing `className`, `style`, `data-slot`, and `disabled` expression (pass any existing `disabled={…canSave}` style guard straight through; `<SubmitButton>` ORs it with `pending`). Add the `SubmitButton` import to each file.

- [ ] **Step 1: `edit-panel.client.tsx`**

The `<form action={updateStaff}>` submit button is around line 480 (`type="submit"`, `data-slot="edit-panel-save"`, `disabled={!canSave}`, raw inline style, text "Save changes"). Replace it with `<SubmitButton>` carrying the same `className`/`style`/`data-slot`/`disabled`, `pendingLabel="Saving…"`, children `Save changes`.

- [ ] **Step 2: `add-staff-wizard.client.tsx`**

Find the final-step submit button inside `<form action={addStaff}>` (around line 314). Replace it with `<SubmitButton>` keeping its chrome, `pendingLabel="Adding…"`, and its existing idle label.

- [ ] **Step 3: `danger-zone.client.tsx`**

Two destructive submit buttons (lines ~133 and ~147) — `deactivateStaff` and `removeStaff` forms — both `<button type="submit" data-slot="confirm-dialog-submit" style={destructiveButtonStyle}>`. Replace each with `<SubmitButton>` keeping `data-slot` + `style={destructiveButtonStyle}`, with `pendingLabel="Deactivating…"` and `pendingLabel="Removing…"` respectively. Also handle the reactivate `<form action={reactivateStaff}>` submit (line ~116 area) → `pendingLabel="Reactivating…"`.

- [ ] **Step 4: `change-pin-modal.client.tsx`**

Find the submit button inside `<form action={setStaffPin}>` (around line 167). Replace with `<SubmitButton>` keeping its chrome, `pendingLabel="Saving…"`.

- [ ] **Step 5: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint components/lacquer/staff/edit-panel.client.tsx components/lacquer/staff/add-staff-wizard.client.tsx components/lacquer/staff/danger-zone.client.tsx components/lacquer/staff/change-pin-modal.client.tsx && npx prettier --check components/lacquer/staff/edit-panel.client.tsx components/lacquer/staff/add-staff-wizard.client.tsx components/lacquer/staff/danger-zone.client.tsx components/lacquer/staff/change-pin-modal.client.tsx`
Expected: all pass.

- [ ] **Step 6: Run staff unit tests**

Run: `npx vitest run tests/unit/staff`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/lacquer/staff/edit-panel.client.tsx components/lacquer/staff/add-staff-wizard.client.tsx components/lacquer/staff/danger-zone.client.tsx components/lacquer/staff/change-pin-modal.client.tsx
git commit -m "$(cat <<'EOF'
feat: add pending states to staff form submit buttons

Edit, add-staff, change-PIN and the danger-zone destructive actions
now show a spinner + pending label while their action runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Checkout charge buttons

The "Take cash" / "Send to Square" charge button (`app/(studio)/checkout/checkout-screen.client.tsx`, around line 2046) is a raw `<button>` driven by the existing `inflight` state. It is **not** a form submit, so it does not use `<SubmitButton>` — it reads `inflight` directly and renders an in-button `<Spinner>` + label swap.

**Files:**
- Modify: `app/(studio)/checkout/checkout-screen.client.tsx`

- [ ] **Step 1: Add the Spinner import**

In `checkout-screen.client.tsx`, add to the existing imports: `import { Spinner } from "@/components/ui/spinner";`.

- [ ] **Step 2: Show a pending state on the charge button**

The charge button currently renders only its label text. Update its content so that while `inflight` is true it shows a spinner + a pending label, and keep the existing label otherwise. Replace the button's children expression:

```tsx
                  {hasUnpricedLines
                    ? "Set price on highlighted items"
                    : chargeMethodIsCard
                      ? `Send to Square · ${fmt(totals.totalCents)}`
                      : `Take cash · ${fmt(totals.totalCents)}`}
```

with:

```tsx
                  {inflight ? (
                    <>
                      <Spinner size={20} strokeWidth={2} />
                      {chargeMethodIsCard ? "Sending to terminal…" : "Charging…"}
                    </>
                  ) : hasUnpricedLines ? (
                    "Set price on highlighted items"
                  ) : chargeMethodIsCard ? (
                    `Send to Square · ${fmt(totals.totalCents)}`
                  ) : (
                    `Take cash · ${fmt(totals.totalCents)}`
                  )}
```

The button already has `display: "inline-flex"`, `alignItems: "center"`, `justifyContent: "center"` in its inline style, so the spinner sits inline with no further style change. Its `gap` — add `gap: "var(--space-2)"` to the button's inline `style` object so the spinner and label are spaced when `inflight`.

- [ ] **Step 3: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint "app/(studio)/checkout/checkout-screen.client.tsx" && npx prettier --check "app/(studio)/checkout/checkout-screen.client.tsx"`
Expected: all pass.

- [ ] **Step 4: Run checkout unit tests**

Run: `npx vitest run tests/unit/checkout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(studio)/checkout/checkout-screen.client.tsx"
git commit -m "$(cat <<'EOF'
feat: show a processing state on the checkout charge button

The Take cash / Send to Square button shows a spinner + pending
label during the inflight window before the payment settles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Normalize existing partial-loading buttons

Seven components already disable + swap text on pending but omit the spinner the design system's button-loading spec requires. Add the spinner so they match the canonical pattern. **Do not change any other behavior or chrome** — only add the spinner.

For shadcn `<Button>` consumers, the cleanest change is to pass `loading={pending}` (which prepends the spinner, disables, sets aria-busy, applies 0.72 opacity) and let the existing `{pending ? "…" : "…"}` child stay as the label. Drop the now-redundant explicit `disabled={pending}` (the `loading` prop handles it). For raw `<button>` consumers, add `<Spinner>` next to the label while pending.

**Files:**
- Modify: `components/lacquer/settings/square/connect-button.client.tsx`
- Modify: `components/lacquer/settings/square/disconnect-button.client.tsx`
- Modify: `components/lacquer/settings/square/device-list.tsx`
- Modify: `components/lacquer/eod/cash-count.client.tsx`
- Modify: `components/lacquer/eod/history/edit-form.client.tsx`
- Modify: `components/lacquer/payroll/tech-pay-action.client.tsx`
- Modify: `components/lacquer/payroll/close-period-dialog.client.tsx`

- [ ] **Step 1: `connect-button.client.tsx`**

It renders a shadcn `<Button onClick={handleClick} disabled={pending}>`. Change to `<Button onClick={handleClick} loading={pending} data-testid="square-connect-button">` — remove `disabled={pending}` (replaced by `loading`). Keep the `{pending ? "Opening Square…" : "Connect Square"}` child unchanged.

- [ ] **Step 2: `disconnect-button.client.tsx`**

Read the file. Same change: if it uses a shadcn `<Button>`, swap `disabled={pending}` → `loading={pending}`, keep the label-swap child. If it is a raw `<button>`, add a `<Spinner>` (import it) before the label while pending.

- [ ] **Step 3: `device-list.tsx`**

Read the file (`useTransition`, `disabled={pending}` on a rename input + radios around line 117). The mutations here are inline-edit controls, not a labelled button. Add a small `<Spinner size={16}>` adornment shown next to the row's controls while that row's mutation is `pending` (import `Spinner`). Keep the existing `disabled={pending}` guards. If there is no natural place for an inline spinner without restructuring, leave a `data-loading` attribute on the row container and skip the visual — note that in the commit body.

- [ ] **Step 4: `cash-count.client.tsx`**

Read the file. The close-drawer button uses `useTransition` with `disabled={pending}` + label "Closing…". If it is a shadcn `<Button>`, swap to `loading={pending}`; if raw, add a `<Spinner>` before the label while pending.

- [ ] **Step 5: `eod/history/edit-form.client.tsx`**

Read the file. The save button uses `disabled={pending}` + label swap "Saving changes". Same treatment — `loading={pending}` for a shadcn `<Button>`, or an inline `<Spinner>` for a raw button.

- [ ] **Step 6: `tech-pay-action.client.tsx`**

Read the file. Buttons for `recordPayout` / `undoPayout` with `disabled={pending}` + label swaps ("Recording…" / "Undoing…"). Same treatment.

- [ ] **Step 7: `close-period-dialog.client.tsx`**

Read the file. The confirm button uses `disabled={pending}`. Same treatment.

- [ ] **Step 8: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint components/lacquer/settings/square/connect-button.client.tsx components/lacquer/settings/square/disconnect-button.client.tsx components/lacquer/settings/square/device-list.tsx components/lacquer/eod/cash-count.client.tsx components/lacquer/eod/history/edit-form.client.tsx components/lacquer/payroll/tech-pay-action.client.tsx components/lacquer/payroll/close-period-dialog.client.tsx && npx prettier --check components/lacquer/settings/square/connect-button.client.tsx components/lacquer/settings/square/disconnect-button.client.tsx components/lacquer/settings/square/device-list.tsx components/lacquer/eod/cash-count.client.tsx components/lacquer/eod/history/edit-form.client.tsx components/lacquer/payroll/tech-pay-action.client.tsx components/lacquer/payroll/close-period-dialog.client.tsx`
Expected: all pass.

- [ ] **Step 9: Run affected unit tests**

Run: `npx vitest run tests/unit/square tests/unit/end-of-day tests/unit/payroll`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add components/lacquer/settings/square/connect-button.client.tsx components/lacquer/settings/square/disconnect-button.client.tsx components/lacquer/settings/square/device-list.tsx components/lacquer/eod/cash-count.client.tsx components/lacquer/eod/history/edit-form.client.tsx components/lacquer/payroll/tech-pay-action.client.tsx components/lacquer/payroll/close-period-dialog.client.tsx
git commit -m "$(cat <<'EOF'
feat: add spinners to existing partial-loading buttons

Square connect/disconnect, device list, EOD cash-count and history
edit, and payroll pay/close buttons now render the canonical
button-loading spinner alongside their existing pending labels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Processing, section & cleanup

### Task 15: PIN entry processing state

While `submitPin` verifies (and, on success, redirects), the PIN modal must visibly read as "processing" instead of sitting on 4 static dots.

**Files:**
- Modify: `components/lacquer/select-staff/pin-entry-modal.client.tsx`
- Modify: `styles/select-staff.css`

- [ ] **Step 1: Add the processing CSS**

In `styles/select-staff.css`, after the `.select-staff-modal-prompt` rule (around line 322), add:

```css
/* ---------- PIN verification (processing) ---------- */
/* Shown in place of the prompt line while `submitPin` is in flight —
   an inline spinner + "Signing in…". The keypad below is already inert
   during `isPending`; `data-verifying` dims it so it visibly reads as
   locked. */
.select-staff-modal-prompt[data-verifying="true"] {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--muted-foreground);
}
.select-staff-pin-pad[data-verifying="true"] {
  opacity: 0.5;
  pointer-events: none;
}
```

Note: confirm the keypad's actual class name from `pin-pad.tsx` / `select-staff.css` while reading — if it is not `.select-staff-pin-pad`, use the real class. The keypad is already non-interactive via the `isPending` guards in the modal; this rule only adds the dim.

- [ ] **Step 2: Render the processing state in the modal**

In `components/lacquer/select-staff/pin-entry-modal.client.tsx`:

Add the import: `import { Spinner } from "@/components/ui/spinner";`.

Replace the prompt element:

```tsx
          <DialogDescription className="select-staff-modal-prompt">
            Enter your 4-digit PIN
          </DialogDescription>
```

with:

```tsx
          <DialogDescription
            className="select-staff-modal-prompt"
            data-verifying={isPending ? "true" : undefined}
          >
            {isPending ? (
              <>
                <Spinner size={16} />
                Signing in…
              </>
            ) : (
              "Enter your 4-digit PIN"
            )}
          </DialogDescription>
```

Then add `data-verifying={isPending ? "true" : undefined}` to the `<PinPad>` — if `<PinPad>` does not forward arbitrary props to its root element, instead wrap `<PinPad>` in a `<div data-verifying={…} className="select-staff-pin-pad-wrap">` and target that wrapper in the CSS from Step 1. Confirm `PinPad`'s prop forwarding while reading `pin-pad.tsx`.

- [ ] **Step 3: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint components/lacquer/select-staff/pin-entry-modal.client.tsx && npx prettier --check components/lacquer/select-staff/pin-entry-modal.client.tsx styles/select-staff.css`
Expected: all pass.

- [ ] **Step 4: Run select-staff / auth unit tests**

Run: `npx vitest run tests/unit/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/lacquer/select-staff/pin-entry-modal.client.tsx styles/select-staff.css
git commit -m "$(cat <<'EOF'
feat: show a processing state after PIN entry

While submitPin verifies and redirects, the prompt swaps to a
spinner + "Signing in…" and the keypad dims — no more silent wait
on four static dots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Onboarding search in-place spinner

The onboarding search re-fetches from the server on each (debounced) keystroke with no indicator. Show a `<Spinner>` inside the input while the `router.replace` transition is pending.

**Files:**
- Modify: `components/lacquer/onboarding/onboarding-search.client.tsx`
- Possibly modify: `styles/onboarding.css`

- [ ] **Step 1: Surface the transition's pending flag**

In `onboarding-search.client.tsx`, change `const [, startTransition] = useTransition();` to `const [isSearching, startTransition] = useTransition();`.

- [ ] **Step 2: Render the spinner in the input**

Add `import { Spinner } from "@/components/ui/spinner";`. After the `<input>` inside `.onb-search`, add a trailing spinner shown only while searching:

```tsx
      {isSearching ? <Spinner size={16} className="onb-search-spinner" /> : null}
```

- [ ] **Step 3: Position the spinner**

Read `styles/onboarding.css` for the `.onb-search` / `.onb-search-icon` rules to match their positioning idiom. Add an `.onb-search-spinner` rule that places the spinner at the trailing (inline-end) edge of the search box, mirroring how `.onb-search-icon` is placed at the leading edge, coloured `var(--muted-foreground)`. If `.onb-search` is `display: flex`, a simple trailing flex child with `margin-inline-start: auto` may suffice — match the existing layout.

- [ ] **Step 4: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint components/lacquer/onboarding/onboarding-search.client.tsx && npx prettier --check components/lacquer/onboarding/onboarding-search.client.tsx styles/onboarding.css`
Expected: all pass.

- [ ] **Step 5: Run onboarding unit tests**

Run: `npx vitest run tests/unit/onboarding`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/lacquer/onboarding/onboarding-search.client.tsx styles/onboarding.css
git commit -m "$(cat <<'EOF'
feat: show a spinner while the onboarding search re-fetches

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Unify the reconnecting banner on `<Spinner>`

`reconnecting-banner.tsx` uses Lucide `Loader` + an ad-hoc `studio-spin` keyframe. Swap it to `<Spinner>` so the app has exactly one spinner implementation.

**Files:**
- Modify: `components/lacquer/reconnecting-banner.tsx`

- [ ] **Step 1: Replace the spinner**

In `components/lacquer/reconnecting-banner.tsx`:
- Remove `import { Loader } from "lucide-react";` and add `import { Spinner } from "@/components/ui/spinner";`.
- Replace the `<Loader … />` element with `<Spinner size={16} />`.
- Delete the inline `<style>{`@keyframes studio-spin …`}</style>` element (no longer referenced).

The surrounding `role="status"` / `aria-live="polite"` container and "Reconnecting…" text stay exactly as they are — they carry the accessible status, and `<Spinner>` is `aria-hidden`.

- [ ] **Step 2: Check for other `studio-spin` references**

Run: `grep -rn "studio-spin" app/ components/ styles/`
Expected: no output. If `studio-spin` is referenced elsewhere, leave the keyframe definition where that reference can still resolve it; otherwise its removal here is clean.

- [ ] **Step 3: Typecheck, lint, format**

Run: `npm run typecheck && npx eslint components/lacquer/reconnecting-banner.tsx && npx prettier --check components/lacquer/reconnecting-banner.tsx`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add components/lacquer/reconnecting-banner.tsx
git commit -m "$(cat <<'EOF'
refactor: use <Spinner> in the reconnecting banner

Drops the ad-hoc Lucide Loader + studio-spin keyframe so the app has
a single spinner implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Verification & PR

### Task 18: E2E coverage, full gate set, PR

**Files:**
- Modify: an existing e2e spec for the PIN flow (likely `tests/e2e/auth.spec.ts`) and one form spec.

- [ ] **Step 1: Add an e2e assertion for the PIN processing state**

Read `tests/e2e/auth.spec.ts` (and the select-staff spec, if separate). In the test that enters a correct PIN, after the 4th digit and before the post-login assertion, assert the processing state appears — e.g. the prompt shows "Signing in…" or the prompt element has `data-verifying="true"`. Use a tolerant assertion (it is a brief window) such as awaiting the text with a short timeout, or assert it on the failed-PIN path where the modal stays open. Keep the rest of the test unchanged.

- [ ] **Step 2: Add an e2e assertion for one form pending state**

Pick one form spec (e.g. the Square connect or a staff spec) and assert that clicking the action shows the disabled/`aria-busy` state. Keep it tolerant — assert `aria-busy="true"` or the disabled attribute on the button immediately after the click.

- [ ] **Step 3: Run the cheap gates**

Run: `npm run format:check && npm run lint && npm run typecheck && npm test`
Expected: all green. Fix anything that fails (`npm run format` for Prettier).

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e`
Expected: green. This resets the local Supabase and runs the chained projects (see `CLAUDE.md` "Two-phase e2e projects"). If the local Supabase stack is down, start it (`supabase start`) first.

- [ ] **Step 5: Visual fidelity check**

Open `design-system/preview/loading.html` in a browser and run the app (`npm run dev`). Spot-check: a route skeleton (e.g. `/services`), a button pending state, and the PIN processing state — confirm the spinner cadence, shimmer, and colors match the reference and every value traces to a token.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin fix/ui-fixes
gh pr create --title "Add loading & processing states across the app" --body "$(cat <<'EOF'
## Summary

Adds page-load, button, section, and processing loading states across
the app, all traced to the design system's canonical loading.html
patterns.

- New primitives: `<Spinner>`, `<Skeleton>`, `<SubmitButton>`, a
  `loading` prop on `<Button>`, and `styles/loading.css`.
- Migrated the 4 existing route skeletons from the pulse to the
  canonical shimmer; removed the dead `tx-skeleton` CSS.
- Added `loading.tsx` skeletons for select-staff, checkout (×2),
  end-of-day (×3), payroll detail, services, and settings sub-pages.
- Pending states on all auth and staff form submit buttons, the
  checkout charge buttons, and the previously partial Square / EOD /
  payroll buttons.
- A visible "Signing in…" processing state after PIN entry.
- An in-place spinner for the onboarding search.
- Unified the reconnecting banner on `<Spinner>`.

Spec: `docs/superpowers/specs/2026-05-20-loading-states-design.md`
Plan: `docs/superpowers/plans/2026-05-20-loading-states.md`

## Test plan

- Unit: new tests for `<Spinner>`, `<Skeleton>`, `<Button loading>`,
  `<SubmitButton>`; full `npm test` green.
- E2E: full `npm run test:e2e` green, with new assertions for the PIN
  processing state and a form pending state.
- Visual: spot-checked against `design-system/preview/loading.html`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Verify CI**

Run: `gh pr checks --watch`
Expected: all checks pass. If CI bounces, fix and push.

---

## Self-review notes

- **Spec coverage:** §5.1 primitives → Tasks 1–5. §5.2 skeletons → Tasks 6–10. §5.3 buttons → Tasks 11–14. §5.4 PIN → Task 15. §5.5 search → Task 16. §5.6 cleanup → Task 17. §6 testing → Tasks 2–5 (unit) + Task 18 (e2e/gates).
- **`<SubmitButton>` chrome:** realized as a chrome-agnostic raw-`<button>` wrapper (Task 5) because no form in the codebase uses the shadcn `<Button>` as its submit — this keeps every form's existing chrome while adding the pending state, matching the spec's "never changes a button's chrome" constraint.
- **Skeleton type consistency:** `<Skeleton>` props (`width`, `height`, `radius`, `className`, `style`) are used identically in Tasks 6–10. `<Spinner>` props (`size`, `strokeWidth`, `className`) used identically in Tasks 4, 13, 15–17.
- **Open verifications carried into tasks (the page chrome and class names cannot be pre-written without reading the target):** Tasks 7–10 read each page before building its skeleton; Task 10 Step 4 decides per-page whether a settings stub needs a skeleton; Task 14 reads each button to choose `loading` prop vs inline `<Spinner>`; Task 15 confirms the keypad class name and `PinPad` prop forwarding. These are explicit read-then-implement steps, not placeholders.
