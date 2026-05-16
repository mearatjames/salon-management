import { Card, CardContent } from "@/components/ui/card";

export default function NotificationsSettingsPage() {
  return (
    <Card>
      <CardContent
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-12)",
          color: "var(--muted-foreground)",
          fontSize: "var(--text-sm, 14px)",
        }}
      >
        Not part of this prototype
      </CardContent>
    </Card>
  );
}
