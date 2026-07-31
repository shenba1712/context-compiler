import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`landing fits within ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Stop paying for pages your agent doesn’t read." })
    ).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));

    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.innerHeight + 2);
  });
}
