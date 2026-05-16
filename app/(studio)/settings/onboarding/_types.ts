// Onboarding row shape — projected from the staff table for the
// /settings/onboarding page. `pin_hash` is dropped in the projection;
// `pin_set` is the boolean derived field that crosses the
// server/client boundary instead (mirrors the staff page pattern).

export type InviteMethod = "magic_link" | "password";

export type OnboardingSection = "pending" | "active" | "offboarded";

export type OffboardReason =
  | "Left the salon"
  | "On extended leave"
  | "Role change"
  | "Performance"
  | "Other";

export type OnboardingUser = {
  id: string;
  user_id: string | null;
  display_name: string;
  email: string | null;
  role: "owner" | "manager" | "technician" | "front_desk";
  color_token: string;
  state: "active" | "invited" | "offboarded";
  invite_method: InviteMethod | null;
  invited_at: string | null;
  offboarded_at: string | null;
  offboard_reason: string | null;
  last_sign_in_at: string | null;
  pin_set: boolean;
  is_you: boolean;
};
