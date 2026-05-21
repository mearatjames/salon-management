"use client";

// FormPendingSignal — a zero-markup bridge that surfaces a form's
// submission status to a parent that lives OUTSIDE the form.
//
// React's `useFormStatus()` only reports the pending state of the
// nearest ENCLOSING `<form>`. For forms submitted programmatically
// (`form.requestSubmit()`) — where the visible trigger button is not a
// child of the form — render this component as a CHILD of the
// `<form action={…}>`. It renders nothing; it just calls
// `onPendingChange` whenever the form's action starts/stops running, so
// the parent can drive a spinner / disabled state on the real trigger.
//
// Pass a stable callback (a `useState` setter is stable, or wrap with
// `useCallback`) so the effect does not re-run every render.

import { useEffect } from "react";
import { useFormStatus } from "react-dom";

export function FormPendingSignal({
  onPendingChange,
}: {
  onPendingChange: (pending: boolean) => void;
}) {
  const { pending } = useFormStatus();

  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);

  return null;
}
