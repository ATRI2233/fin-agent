import { test, expect } from "@playwright/test";

test("view framework page and execution monitor", async ({ page }) => {
  await page.goto("/framework");
  await expect(page).toHaveURL(/.*\/framework/);
  // Framework 页面可能包含执行监控
  await expect(page.locator("body")).toBeVisible();
});

test("navigate to workflow monitor", async ({ page }) => {
  await page.goto("/");
  // 找 Workflows 菜单
  await page.getByRole("link", { name: /workflow/i }).first().click();
  await expect(page).toHaveURL(/.*workflow/);
});
