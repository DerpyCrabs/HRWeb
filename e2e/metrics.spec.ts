import { expect, test } from "@playwright/test";
import { clearAppStorage, makeLogEntry, seedExerciseLog } from "./helpers";

test.describe("Metrics view", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("shows empty state without typed exercises", async ({ page }) => {
    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-empty")).toBeVisible();
  });

  test("shows TRIMP chart for any typed exercise", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "typed-1", exerciseType: "General" }),
    ]);

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-section-general")).toBeVisible();
    await expect(page.getByTestId("metrics-trimp-chart")).toBeVisible();
    await expect(page.getByTestId("metrics-zone2-chart")).toHaveCount(0);
    await expect(page.getByTestId("metrics-hrr-chart")).toHaveCount(0);
  });

  test("shows Zone 2 and TRIMP charts for LISS type", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "liss-1", exerciseType: "LISS steady state" }),
    ]);

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-section-liss-steady-state")).toBeVisible();
    await expect(page.getByTestId("metrics-zone2-chart")).toBeVisible();
    await expect(page.getByTestId("metrics-trimp-chart")).toBeVisible();
    await expect(page.getByTestId("metrics-hrr-chart")).toHaveCount(0);
  });

  test("shows HRR and TRIMP charts for HIIT type", async ({ page }) => {
    const hiitReadings = [
      { bpm: 100, time: 0 },
      { bpm: 140, time: 30_000 },
      { bpm: 150, time: 60_000 },
      { bpm: 130, time: 150_000 },
      { bpm: 120, time: 210_000 },
    ];

    await seedExerciseLog(page, [
      makeLogEntry({
        id: "hiit-1",
        exerciseType: "HIIT intervals",
        durationMs: 240_000,
        readings: hiitReadings,
      }),
    ]);

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-section-hiit-intervals")).toBeVisible();
    await expect(page.getByTestId("metrics-hrr-chart")).toBeVisible();
    await expect(page.getByTestId("metrics-trimp-chart")).toBeVisible();
  });

  test("shows HRR and TRIMP charts for Strength type", async ({ page }) => {
    const strengthReadings = [
      { bpm: 90, time: 0 },
      { bpm: 130, time: 30_000 },
      { bpm: 140, time: 60_000 },
      { bpm: 125, time: 120_000 },
      { bpm: 110, time: 180_000 },
    ];

    await seedExerciseLog(page, [
      makeLogEntry({
        id: "strength-1",
        exerciseType: "Strength training",
        durationMs: 200_000,
        readings: strengthReadings,
      }),
    ]);

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-section-strength-training")).toBeVisible();
    await expect(page.getByTestId("metrics-hrr-chart")).toBeVisible();
    await expect(page.getByTestId("metrics-trimp-chart")).toBeVisible();
  });

  test("groups multiple exercise types into separate sections", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "m-run", exerciseType: "Running" }),
      makeLogEntry({ id: "m-liss", exerciseType: "LISS", stoppedAt: Date.now() - 1000 }),
    ]);

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-section-running")).toBeVisible();
    await expect(page.getByTestId("metrics-section-liss")).toBeVisible();
  });

  test("switches trend grouping between week and month", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "group-1", exerciseType: "LISS" }),
    ]);

    await page.getByTestId("view-tab-metrics").click();
    await expect(page.getByTestId("metrics-grouping")).toHaveValue("week");

    await page.getByTestId("metrics-grouping").selectOption("month");
    await expect(page.getByTestId("metrics-grouping")).toHaveValue("month");
    await expect(page.getByTestId("metrics-zone2-chart")).toBeVisible();
  });
});
