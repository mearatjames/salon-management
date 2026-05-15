// LoginForm — server component. Renders an email + password form whose
// `action` is the `signInWithPassword` Server Action.
//
// No client JS: the form is a plain HTML submission to the Server Action,
// which redirects with `?error=invalid` on failure (rendered by the parent
// page) or to `/select-staff` on success. Hidden `next` field propagates the
// query string verbatim through the action — sanitization happens later
// (R6: sanitize at the cookie-issuing boundary, not at every hop).
//
// All visuals trace to `var(--*)` tokens via shadcn primitives + the
// `.auth-form-row` / `.auth-form-actions` utilities in `styles/auth.css`.

import { signInWithPassword } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LoginFormProps = {
  next?: string;
};

export function LoginForm({ next }: LoginFormProps) {
  return (
    <form action={signInWithPassword}>
      <div className="auth-form-row">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </div>
      <div className="auth-form-row" style={{ marginTop: "var(--space-3)" }}>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="auth-form-actions">
        <Button type="submit">Sign in</Button>
      </div>
    </form>
  );
}
