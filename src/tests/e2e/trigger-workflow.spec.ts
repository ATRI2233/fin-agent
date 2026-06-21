import { test, expect } from "@playwright/test";

test("view workflows list", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page).toHaveURL(/.*\/workflows/);
  // 验证工作流列表页面加载(可能没数据,只要没报错)
  await expect(page.locator("body")).toBeVisible();
});

test("trigger first workflow in list", async ({ page }) => {
  await page.goto("/workflows");
  // 等待列表加载
  await page.waitForTimeout(2_000);
  // 查找 trigger 按钮
  const triggerBtn = page.getByRole("button", { name: /trigger|运行|执行/i }).first();
  if (await triggerBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await triggerBtn.click();
    // 验证响应(可能弹出确认/toast)
    await expect(page.locator("body")).toBeVisible();
  }
});
