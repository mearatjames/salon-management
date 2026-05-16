"use client";

// auth-views.tsx — the client island for the 010-login-redesign login
// surface. Hosts the five view components that the `/login` server
// component picks between based on URL precedence (per
// `routes.contract.md § View selection precedence`):
//
//   • <SignInView>     — default; email + password (with reveal toggle)
//                        + Google + magic-link link
//   • <ForgotView>     — `?reset_intent=1`
//   • <ForgotSentView> — `?reset_sent=<email>`
//   • <MagicView>      — `?magic_intent=1`
//   • <MagicSentView>  — `?magic_sent=<email>`
//
// Phase 4 (US2): SignInView hosts the full sign-in form inline (the
// standalone `LoginForm` component was absorbed and deleted) with a
// password-reveal toggle (`<Eye/>` ↔ `<EyeOff/>`) wired to local
// `useState`. The toggle resets on view-swap because <SignInView>
// unmounts when the page-level view router picks a different view —
// React's natural unmount/remount lifecycle resets the `shown` state
// back to `false`; no `useEffect` needed.
//
// Phase 8 (T062): <AuthClientRouter> is a top-level wrapper that
// intercepts `<a href="/login?...">` clicks within itself. On click:
// `event.preventDefault()`, parses target query params, calls
// `history.pushState({}, '', newUrl)`, then re-evaluates which view to
// render. The view is re-mounted (different React key) so the `viewIn`
// animation runs. Browser back/forward triggers the same swap via the
// standard `popstate` listener. No new dependency. The wrapper skips
// interception for: cmd/ctrl-click (new tab), middle-click,
// target=_blank, anchors with download attr. Anchors whose href does
// not start with `/login?` or is not exactly `/login` pass through
// untouched (e.g. external links, /reset-password). The no-JS path
// continues to work end-to-end since the server still picks the right
// view from URL params on every request.

import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  sendPasswordReset,
  signInWithMagicLink,
  signInWithPassword,
} from "@/app/(auth)/login/actions";
import {
  GoogleSignInButton,
  isGoogleSignInEnabled,
} from "@/components/lacquer/google-sign-in-button";

function nextSuffix(next: string | undefined): string {
  return next ? encodeURIComponent(next) : "";
}

export type SignInViewProps = {
  next?: string;
  error?: string;
};

export function SignInView({ next, error }: SignInViewProps) {
  const nextEncoded = nextSuffix(next);
  const magicHref = `/login?magic_intent=1${nextEncoded ? `&next=${nextEncoded}` : ""}`;
  const forgotHref = `/login?reset_intent=1${nextEncoded ? `&next=${nextEncoded}` : ""}`;
  const [shown, setShown] = useState(false);

  return (
    <div className="auth-view-pane" key="signin">
      <div className="auth-form-header">
        <h1 className="auth-form-title">Sign in</h1>
        <p className="auth-form-subtitle">Welcome back to Tang Nails Studio</p>
      </div>

      {error === "invalid" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Email or password is incorrect.
        </div>
      )}
      {error === "network" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Couldn&apos;t sign you in. Check your connection and try again.
        </div>
      )}
      {error === "oauth_failed" && (
        <div className="auth-alert auth-alert-error" role="alert">
          We couldn&apos;t complete that sign-in. Try again or use your password.
        </div>
      )}

      <form action={signInWithPassword}>
        <div className="auth-form-body">
          <div className="auth-field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@tangstudio.com"
              className="auth-text-input"
              required
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                const form = event.currentTarget.form;
                const pw = form?.elements.namedItem("password") as HTMLInputElement | null;
                event.preventDefault();
                // If password is still empty, advance focus instead of
                // submitting (HTML5 validation would block silently).
                if (pw && pw.value === "") {
                  pw.focus();
                  return;
                }
                // Otherwise force submission. Safari / iCloud Keychain on
                // React 19 Server Action forms sometimes skips the browser's
                // implicit submit; requestSubmit() is equivalent to clicking
                // the submit button and runs HTML5 validation.
                form?.requestSubmit();
              }}
            />
          </div>

          <div className="auth-field">
            <div className="auth-field-row">
              <label htmlFor="signin-password">Password</label>
              <a href={forgotHref} className="auth-link-btn auth-link-btn-xs">
                Forgot password?
              </a>
            </div>
            <div className="auth-input-wrap">
              <input
                id="signin-password"
                name="password"
                type={shown ? "text" : "password"}
                autoComplete="current-password"
                className="auth-text-input auth-text-input-suffixed"
                required
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  // Safari + iCloud Keychain on React 19 Server Action forms
                  // sometimes swallows implicit submission. Force it.
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              <button
                type="button"
                className="auth-suffix-btn"
                aria-label={shown ? "Hide password" : "Show password"}
                onClick={() => setShown((s) => !s)}
              >
                {shown ? (
                  <EyeOff size={16} strokeWidth={1.5} />
                ) : (
                  <Eye size={16} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <input type="hidden" name="next" value={next ?? ""} />

          <button type="submit" className="auth-btn auth-btn-primary">
            Sign in
          </button>
        </div>
      </form>

      {isGoogleSignInEnabled && (
        <>
          <div className="auth-divider" role="separator" aria-label="or">
            or
          </div>
          <GoogleSignInButton next={next} />
        </>
      )}

      <div style={{ textAlign: "center", paddingTop: "var(--space-1)" }}>
        <a href={magicHref} className="auth-link-btn auth-link-btn-sm">
          Email me a sign-in link instead
        </a>
      </div>
    </div>
  );
}

// ─── Phase 2 stubs ─────────────────────────────────────────────────────
// Filled in by US3 (T038, T039) and US4 (T048, T049). The exported prop
// types document the eventual surface so the `/login` page can compile
// against the real shape today; the bodies ignore their props for now
// and render an empty `.auth-view-pane`.

export type ForgotViewProps = { next?: string; error?: string };
export function ForgotView({ next, error }: ForgotViewProps) {
  const nextEncoded = nextSuffix(next);
  const backHref = nextEncoded ? `/login?next=${nextEncoded}` : "/login";

  return (
    <div className="auth-view-pane" key="forgot">
      <a href={backHref} className="auth-back-btn">
        <ChevronLeft size={16} strokeWidth={1.5} />
        Back to sign in
      </a>
      <div className="auth-form-header">
        <h1 className="auth-form-title">Reset password</h1>
        <p className="auth-form-subtitle">Enter your email and we&apos;ll send a reset link.</p>
      </div>

      {error === "invalid" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Enter your email.
        </div>
      )}

      <form action={sendPasswordReset}>
        <div className="auth-form-body">
          <div className="auth-field">
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@tangstudio.com"
              className="auth-text-input"
              required
            />
          </div>

          <input type="hidden" name="next" value={next ?? ""} />

          <button type="submit" className="auth-btn auth-btn-primary">
            Send reset link
          </button>
        </div>
      </form>
    </div>
  );
}

export type ForgotSentViewProps = { email?: string; next?: string };
export function ForgotSentView({ email, next }: ForgotSentViewProps) {
  const nextEncoded = nextSuffix(next);
  const resendHref = `/login?reset_intent=1${nextEncoded ? `&next=${nextEncoded}` : ""}`;
  const backHref = "/login";

  return (
    <div className="auth-view-pane" key="forgot-sent">
      <a href={backHref} className="auth-back-btn">
        <ChevronLeft size={16} strokeWidth={1.5} />
        Back to sign in
      </a>
      <div className="auth-form-header">
        <h1 className="auth-form-title">Check your email</h1>
        <p className="auth-form-subtitle">A reset link is on its way.</p>
      </div>

      <div className="auth-confirm-card">
        <p>
          We sent a password reset link to <strong>{email ?? ""}</strong>. Click it to set a new
          password.
        </p>
        <p className="auth-confirm-note">
          Didn&apos;t get it? Check your spam folder, or{" "}
          <a href={resendHref} className="auth-link-btn auth-link-btn-xs">
            send another link
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export type MagicViewProps = { next?: string; error?: string };
export function MagicView({ next, error }: MagicViewProps) {
  const nextEncoded = nextSuffix(next);
  const backHref = nextEncoded ? `/login?next=${nextEncoded}` : "/login";

  return (
    <div className="auth-view-pane" key="magic">
      <a href={backHref} className="auth-back-btn">
        <ChevronLeft size={16} strokeWidth={1.5} />
        Back to sign in
      </a>
      <div className="auth-form-header">
        <h1 className="auth-form-title">Sign in with a link</h1>
        <p className="auth-form-subtitle">
          We&apos;ll email you a one-time sign-in link — no password needed.
        </p>
      </div>

      {error === "invalid" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Enter your email.
        </div>
      )}

      <form action={signInWithMagicLink}>
        <div className="auth-form-body">
          <div className="auth-field">
            <label htmlFor="magic-email">Email</label>
            <input
              id="magic-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@tangstudio.com"
              className="auth-text-input"
              required
            />
          </div>

          <input type="hidden" name="next" value={next ?? ""} />

          <button type="submit" className="auth-btn auth-btn-primary">
            Send link
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── T062: client-side view-swap router ─────────────────────────────────
// <AuthClientRouter> wraps the server-rendered initial view. On
// hydration it installs:
//   1. A delegated click listener that intercepts `/login?...` (or bare
//      `/login`) anchor clicks, calls `history.pushState`, and re-reads
//      the URL to swap the view in-place — no server round-trip.
//   2. A `popstate` listener so the browser's back / forward buttons
//      trigger the same in-place swap.
// The initial render (SSR) renders `children` verbatim so the no-JS
// path stays identical to the server. After the first popstate or
// intercepted click, the wrapper takes over and renders one of the
// five views from local state. Each view component is given a stable
// React `key` matching the view name; React's natural remount triggers
// the `viewIn` animation (gated by `prefers-reduced-motion` in CSS).

type AuthViewName = "signin" | "forgot" | "forgot-sent" | "magic" | "magic-sent";

type AuthViewState = {
  view: AuthViewName;
  next?: string;
  error?: string;
  email?: string;
};

function pickViewFromSearch(search: string): AuthViewState {
  const params = new URLSearchParams(search);
  const next = params.get("next") ?? undefined;
  const error = params.get("error") ?? undefined;
  const resetSent = params.get("reset_sent");
  const resetIntent = params.get("reset_intent");
  const magicSent = params.get("magic_sent");
  const magicIntent = params.get("magic_intent");

  if (resetSent !== null) return { view: "forgot-sent", email: resetSent, next };
  if (resetIntent !== null) return { view: "forgot", next, error };
  if (magicSent !== null) return { view: "magic-sent", email: magicSent, next };
  if (magicIntent !== null) return { view: "magic", next, error };
  return { view: "signin", next, error };
}

function renderViewFromState(state: AuthViewState): ReactNode {
  switch (state.view) {
    case "forgot-sent":
      return <ForgotSentView key="forgot-sent" email={state.email} next={state.next} />;
    case "forgot":
      return <ForgotView key="forgot" next={state.next} error={state.error} />;
    case "magic-sent":
      return <MagicSentView key="magic-sent" email={state.email} next={state.next} />;
    case "magic":
      return <MagicView key="magic" next={state.next} error={state.error} />;
    case "signin":
    default:
      return <SignInView key="signin" next={state.next} error={state.error} />;
  }
}

export function AuthClientRouter({ children }: { children: ReactNode }) {
  // `hydrated` flips to `true` on the first popstate event (real or
  // synthetic) so we know to render from local state instead of the
  // server-rendered children. Until then, SSR output renders verbatim.
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<AuthViewState>(() => ({ view: "signin" }));

  const syncFromLocation = useCallback(() => {
    if (typeof window === "undefined") return;
    setState(pickViewFromSearch(window.location.search));
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Browser back / forward fires native `popstate`. Our intercepted
    // anchor clicks also dispatch a synthetic `popstate` so we reuse
    // the same listener for both cases.
    const handler = () => syncFromLocation();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [syncFromLocation]);

  const onClickCapture = useMemo(
    () => (event: React.MouseEvent<HTMLDivElement>) => {
      // Honour modifier-clicks / middle-clicks / new-tab clicks.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const hrefAttr = anchor.getAttribute("href");
      if (!hrefAttr) return;
      // Only intercept same-origin `/login` and `/login?...` links. Skip
      // hashes / external / other-pathname links.
      if (hrefAttr !== "/login" && !hrefAttr.startsWith("/login?")) return;

      event.preventDefault();
      // Resolve via the absolute URL to honour any base href and to
      // normalise query encoding.
      const resolved = new URL(anchor.href, window.location.href);
      const newPath = `${resolved.pathname}${resolved.search}${resolved.hash}`;
      window.history.pushState({}, "", newPath);
      // pushState does NOT fire popstate; dispatch synthetic so the
      // useEffect listener re-reads the URL and swaps the view.
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    []
  );

  return (
    <div onClickCapture={onClickCapture} data-auth-client-router="">
      {hydrated ? renderViewFromState(state) : children}
    </div>
  );
}

export type MagicSentViewProps = { email?: string; next?: string };
export function MagicSentView({ email, next }: MagicSentViewProps) {
  const nextEncoded = nextSuffix(next);
  const resendHref = `/login?magic_intent=1${nextEncoded ? `&next=${nextEncoded}` : ""}`;
  const backHref = "/login";

  return (
    <div className="auth-view-pane" key="magic-sent">
      <a href={backHref} className="auth-back-btn">
        <ChevronLeft size={16} strokeWidth={1.5} />
        Back to sign in
      </a>
      <div className="auth-form-header">
        <h1 className="auth-form-title">Check your email</h1>
        <p className="auth-form-subtitle">A sign-in link is on its way.</p>
      </div>

      <div className="auth-confirm-card">
        <p>
          We sent a sign-in link to <strong>{email ?? ""}</strong>. Click it from your inbox — you
          can close this tab.
        </p>
        <p className="auth-confirm-note">
          Didn&apos;t get it? Check your spam folder, or{" "}
          <a href={resendHref} className="auth-link-btn auth-link-btn-xs">
            send another link
          </a>
          .
        </p>
      </div>
    </div>
  );
}
