import { expect, test } from "@playwright/test";

test("placeholder landing page shows the Tang Nails heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tang Nails" })).toBeVisible();
});
