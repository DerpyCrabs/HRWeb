import { expect, test } from "@playwright/test";
import {
  clearAppStorage,
  holdButton,
  makeLogEntry,
  seedExerciseLog,
} from "./helpers";

test.describe("Exercise log", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("shows empty state when no exercises exist", async ({ page }) => {
    await page.getByTestId("view-tab-log").click();
    await expect(page.getByTestId("log-empty")).toBeVisible();
    await expect(page.getByTestId("export-log-button")).toBeDisabled();
    await expect(page.getByTestId("delete-log-button")).toBeDisabled();
  });

  test("lists seeded exercises and shows details", async ({ page }) => {
    const entry = makeLogEntry({
      id: "seed-run-1",
      exerciseType: "Running",
      durationMs: 180_000,
    });
    await seedExerciseLog(page, [entry]);

    await page.getByTestId("view-tab-log").click();
    await expect(page.getByTestId("log-entry-seed-run-1")).toBeVisible();
    await expect(page.getByTestId("log-entry-seed-run-1")).toContainText("Running");
    await expect(page.getByTestId("heart-chart")).toBeVisible();
    await expect(page.getByTestId("stat-time")).toContainText("03:00");
    await expect(page.getByTestId("stat-min")).not.toContainText("--");
  });

  test("filters log entries by exercise type", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "run-a", exerciseType: "Running", stoppedAt: Date.now() }),
      makeLogEntry({ id: "bike-a", exerciseType: "Cycling", stoppedAt: Date.now() - 1000 }),
      makeLogEntry({ id: "untyped-a", stoppedAt: Date.now() - 2000 }),
    ]);

    await page.getByTestId("view-tab-log").click();
    await page.getByTestId("log-type-filter").selectOption("Running");
    await expect(page.getByTestId("log-entry-run-a")).toBeVisible();
    await expect(page.getByTestId("log-entry-bike-a")).toHaveCount(0);

    await page.getByTestId("log-type-filter").selectOption("__untyped__");
    await expect(page.getByTestId("log-entry-untyped-a")).toBeVisible();
    await expect(page.getByTestId("log-entry-run-a")).toHaveCount(0);

    await page.getByTestId("log-type-filter").selectOption("");
    await expect(page.getByTestId("log-entries").locator("button")).toHaveCount(3);
  });

  test("shows empty filter message when untyped filter has no matches", async ({ page }) => {
    await seedExerciseLog(page, [makeLogEntry({ id: "only-run", exerciseType: "Running" })]);

    await page.getByTestId("view-tab-log").click();
    await page.getByTestId("log-type-filter").selectOption("__untyped__");
    await expect(page.getByTestId("log-filter-empty")).toBeVisible();
  });

  test("selects different log entries", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "older", stoppedAt: Date.now() - 5000, durationMs: 60_000 }),
      makeLogEntry({ id: "newer", stoppedAt: Date.now(), durationMs: 120_000 }),
    ]);

    await page.getByTestId("view-tab-log").click();
    await page.getByTestId("log-entry-older").click();
    await expect(page.getByTestId("log-entry-older")).toHaveClass(/border-\[#d9184b\]/);
    await expect(page.getByTestId("stat-time")).toContainText("01:00");

    await page.getByTestId("log-entry-newer").click();
    await expect(page.getByTestId("stat-time")).toContainText("02:00");
  });

  test("edits exercise type on existing entry", async ({ page }) => {
    await seedExerciseLog(page, [makeLogEntry({ id: "edit-me" })]);

    await page.getByTestId("view-tab-log").click();
    await page.getByTestId("exercise-type-input").fill("Strength");
    await page.getByTestId("exercise-type-save").click();

    await expect(page.getByTestId("log-entry-edit-me")).toContainText("Strength");
  });

  test("deletes entry with hold-to-delete", async ({ page }) => {
    await seedExerciseLog(page, [
      makeLogEntry({ id: "delete-me" }),
      makeLogEntry({ id: "keep-me", stoppedAt: Date.now() - 1000 }),
    ]);

    await page.getByTestId("view-tab-log").click();
    await holdButton(page, "delete-log-button");

    await expect(page.getByTestId("log-entry-delete-me")).toHaveCount(0);
    await expect(page.getByTestId("log-entry-keep-me")).toBeVisible();
  });

  test("imports exercise log from JSON file", async ({ page }) => {
    const payload = {
      version: 2,
      entries: [makeLogEntry({ id: "imported-1", exerciseType: "HIIT" })],
    };

    await page.getByTestId("view-tab-log").click();
    await page.getByTestId("import-log-input").setInputFiles({
      name: "exercise-log.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(payload)),
    });

    await expect(page.getByTestId("log-entry-imported-1")).toBeVisible();
    await expect(page.getByTestId("log-entry-imported-1")).toContainText("HIIT");
  });

  test("exports exercise log as JSON download", async ({ page }) => {
    await seedExerciseLog(page, [makeLogEntry({ id: "export-me", exerciseType: "Rowing" })]);

    await page.getByTestId("view-tab-log").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-log-button").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^exercise-log-\d{4}-\d{2}-\d{2}\.json$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import("node:fs/promises");
    const content = JSON.parse(await fs.readFile(path!, "utf8"));
    expect(content.entries).toHaveLength(1);
    expect(content.entries[0].exerciseType).toBe("Rowing");
  });
});

test.describe("HRR display in log", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
  });

  test("shows HRR stat for HIIT workouts with peak data", async ({ page }) => {
    const hiitReadings = [
      { bpm: 100, time: 0 },
      { bpm: 140, time: 30_000 },
      { bpm: 150, time: 60_000 },
      { bpm: 145, time: 90_000 },
      { bpm: 130, time: 150_000 },
      { bpm: 120, time: 210_000 },
    ];

    await seedExerciseLog(page, [
      makeLogEntry({
        id: "hiit-hrr",
        exerciseType: "HIIT",
        durationMs: 240_000,
        readings: hiitReadings,
      }),
    ]);

    await page.getByTestId("view-tab-log").click();
    await expect(page.getByTestId("log-hrr-stat")).toBeVisible();
    await expect(page.getByTestId("log-hrr-stat")).toContainText("bpm");
  });

  test("does not show HRR stat for untyped workouts", async ({ page }) => {
    await seedExerciseLog(page, [makeLogEntry({ id: "no-hrr" })]);

    await page.getByTestId("view-tab-log").click();
    await expect(page.getByTestId("log-hrr-stat")).toHaveCount(0);
  });
});
