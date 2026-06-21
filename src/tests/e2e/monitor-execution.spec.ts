import { test, expect } from "@playwright/test";

test("view framework page and execution monitor", async ({ page }) => {
  await page.goto("/framework");
  await expect(page).toHaveURL(/.*\/framework/);
  // Framework 页面可能包含执行监控
  await expect(page.locator("body")).toBeVisible();
});

test("navigate to workflow monitor", async ({ page }) => {
  await page.goto("/");
  // "Workflows" 菜单项嵌套在 AntD "Configuration" 子菜单下，默认收起
  // AntD MenuItem 的 ARIA role 是 "menuitem"（不是 "link"），且仅在子菜单展开后可见
  await page.getByRole("menuitem", { name: "Configuration" }).click();
  await page.getByRole("menuitem", { name: "Workflows" }).click();
  await expect(page).toHaveURL(/.*workflow/);
});
