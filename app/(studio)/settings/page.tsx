import { redirect } from "next/navigation";

export default function SettingsRootPage(): never {
  redirect("/settings/staff");
}
