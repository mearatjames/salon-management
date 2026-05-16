"use client";

import { Repeat } from "lucide-react";
import { useFormStatus } from "react-dom";

import { switchStaff } from "@/app/(studio)/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="studio-switch-staff"
      data-slot="switch-staff-button"
      disabled={pending}
      aria-busy={pending || undefined}
    >
      <Repeat size={16} strokeWidth={1.5} aria-hidden="true" />
      Switch staff
    </button>
  );
}

export function SwitchStaffButton() {
  return (
    <form action={switchStaff}>
      <SubmitButton />
    </form>
  );
}
