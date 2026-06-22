import { expect, test } from "@playwright/test";
import { clearAppStorage, connectSimulatedMonitor, ZONES_STORAGE_KEY } from "./helpers";

test.describe("Training zones", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
    await connectSimulatedMonitor(page);
  });

  test("selects target zone by clicking zone band", async ({ page }) => {
    await page.getByTestId("zone-target-2").click();

    await expect(page.getByTestId("zone-target-2")).toHaveClass(/shadow-\[inset/);
    await expect(page.getByTestId("zone-target-3")).not.toHaveClass(/shadow-\[inset/);
  });

  test("persists target zone to localStorage", async ({ page }) => {
    await page.getByTestId("zone-target-4").click();

    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) || "null"),
      ZONES_STORAGE_KEY,
    );
    expect(stored.targetZoneId).toBe(4);
  });

  test("adjusts zone boundary with keyboard", async ({ page }) => {
    const boundary = page.getByTestId("zone-boundary-0");
    await boundary.focus();
    await boundary.press("ArrowRight");

    const label = boundary.locator("span");
    const initialMax = Number(await label.textContent());
    await boundary.press("ArrowRight");
    const updatedMax = Number(await label.textContent());
    expect(updatedMax).toBeGreaterThan(initialMax);
  });

  test("updates trend when target zone changes during exercise", async ({ page }) => {
    await page.getByTestId("exercise-button").click();
    await page.waitForTimeout(2000);

    await page.getByTestId("zone-target-1").click();
    const trend = await page.getByTestId("trend").textContent();
    expect(trend).toMatch(/below Zone 1|In Zone 1|above Zone 1/);
  });
});
