import { expect, test } from "@playwright/test";
import { clearAppStorage } from "./helpers";

test.describe("App shell", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("loads with default disconnected state", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Heart Rate Monitor" })).toBeVisible();
    await expect(page.getByTestId("connect-button")).toBeVisible();
    await expect(page.getByTestId("latest-bpm")).toHaveText("--");
    await expect(page.getByTestId("exercise-button")).toBeDisabled();
    await expect(page.getByTestId("stop-button")).toBeDisabled();
    await expect(page.getByTestId("connection-status")).toHaveText("Idle");
  });

  test("shows live view by default with chart and zone editor", async ({ page }) => {
    await expect(page.getByTestId("view-tab-live")).toBeVisible();
    await expect(page.getByTestId("heart-chart")).toBeVisible();
    await expect(page.getByTestId("zone-time-stats")).toBeVisible();
    await expect(page.getByTestId("zone-target-3")).toBeVisible();
  });

  test("switches between Live, Log, and Metrics tabs", async ({ page }) => {
    await page.getByTestId("view-tab-log").click();
    await expect(page.getByTestId("log-empty")).toBeVisible();

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-empty")).toBeVisible();

    await page.getByTestId("view-tab-live").click();
    await expect(page.getByTestId("heart-chart")).toBeVisible();
  });

  test("displays stat tiles with placeholder values when idle", async ({ page }) => {
    await expect(page.getByTestId("stat-time")).toContainText("00:00");
    await expect(page.getByTestId("stat-min")).toContainText("--");
    await expect(page.getByTestId("stat-avg")).toContainText("--");
    await expect(page.getByTestId("stat-max")).toContainText("--");
  });
});
