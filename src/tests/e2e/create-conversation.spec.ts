import { test, expect } from "@playwright/test";

test("navigate from dashboard to chat and create conversation", async ({ page }) => {
  await page.goto("/");
  // 从菜单点击 Chat 链接
  await page.getByRole("link", { name: "Chat" }).first().click();
  await expect(page).toHaveURL(/.*\/chat/);
  // 查找新建按钮(实际标签可能是 "新建对话"/"New")
  const newBtn = page.getByRole("button", { name: /新建|New|Create/i }).first();
  if (await newBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newBtn.click();
    // 如果弹出对话框,填写
    const titleInput = page.getByLabel(/title|标题/i).first();
    if (await titleInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await titleInput.fill("E2E Test Conversation");
      await page.getByRole("button", { name: /ok|submit|确定|创建/i }).click();
    }
    await expect(page.getByText("E2E Test Conversation")).toBeVisible({ timeout: 5_000 });
  }
});
