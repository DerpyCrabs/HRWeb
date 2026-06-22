import { expect, test } from "@playwright/test";
import { clearAppStorage, connectSimulatedMonitor, disconnectSimulatedMonitor } from "./helpers";

test.describe("Monitor connection", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("connects simulated monitor and shows live BPM", async ({ page }) => {
    await connectSimulatedMonitor(page);

    await expect(page.getByTestId("connection-status")).toHaveText("Live");
    await expect(page.getByTestId("disconnect-button")).toBeVisible();
    await expect(page.getByTestId("connect-button")).toHaveCount(0);
    await expect(page.getByTestId("exercise-button")).toBeEnabled();

    await expect(page.getByTestId("latest-bpm")).not.toHaveText("--", { timeout: 5000 });
    const bpm = Number(await page.getByTestId("latest-bpm").textContent());
    expect(bpm).toBeGreaterThanOrEqual(90);
    expect(bpm).toBeLessThanOrEqual(190);
  });

  test("shows idle preview readings while connected but not exercising", async ({ page }) => {
    await connectSimulatedMonitor(page);

    await expect(page.getByTestId("trend")).toHaveText("Idle");
    await expect(page.getByTestId("stat-time")).not.toContainText("00:00", { timeout: 5000 });
  });

  test("disconnects simulated monitor and resets controls", async ({ page }) => {
    await connectSimulatedMonitor(page);
    await expect(page.getByTestId("latest-bpm")).not.toHaveText("--", { timeout: 5000 });

    await disconnectSimulatedMonitor(page);

    await expect(page.getByTestId("connection-status")).toHaveText("Disconnected");
    await expect(page.getByTestId("connect-button")).toBeVisible();
    await expect(page.getByTestId("exercise-button")).toBeDisabled();
  });

  test("shows pairing state when connect is clicked", async ({ page }) => {
    await page.getByTestId("connect-button").click();
    await expect(page.getByTestId("connection-status")).toHaveText("Pairing");
  });
});
