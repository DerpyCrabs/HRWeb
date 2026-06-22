import { expect, test } from "@playwright/test";
import {
  clearAppStorage,
  connectSimulatedMonitor,
  startExercise,
  stopExercise,
} from "./helpers";

test.describe("Exercise session", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
    await connectSimulatedMonitor(page);
  });

  test("starts, records readings, and shows stats", async ({ page }) => {
    await startExercise(page);

    await expect(page.getByTestId("connection-status")).toHaveText("Recording");
    await expect(page.getByTestId("exercise-button")).toHaveText("Pause");
    await expect(page.getByTestId("stop-button")).toBeEnabled();
    await expect(page.getByTestId("trend")).not.toHaveText("Idle");

    await page.waitForTimeout(2500);

    await expect(page.getByTestId("stat-min")).not.toContainText("--");
    await expect(page.getByTestId("stat-avg")).not.toContainText("--");
    await expect(page.getByTestId("stat-max")).not.toContainText("--");
    await expect(page.getByTestId("stat-time")).not.toContainText("00:00");
  });

  test("pauses and resumes exercise", async ({ page }) => {
    await startExercise(page);
    await page.waitForTimeout(1500);

    await page.getByTestId("exercise-button").click();
    await expect(page.getByTestId("connection-status")).toHaveText("Paused");
    await expect(page.getByTestId("exercise-button")).toHaveText("Resume");
    await expect(page.getByTestId("trend")).toHaveText("Paused");

    const pausedTime = await page.getByTestId("stat-time").textContent();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("stat-time")).toHaveText(pausedTime || "");

    await page.getByTestId("exercise-button").click();
    await expect(page.getByTestId("connection-status")).toHaveText("Recording");
    await expect(page.getByTestId("exercise-button")).toHaveText("Pause");
  });

  test("requires hold to stop and saves to log", async ({ page }) => {
    await startExercise(page);
    await page.waitForTimeout(2000);

    await stopExercise(page);

    await expect(page.getByTestId("view-tab-log")).toHaveClass(/bg-white/);
    await expect(page.getByTestId("log-empty")).toHaveCount(0);
    await expect(page.getByTestId("log-entries").locator("button")).toHaveCount(1);
    await expect(page.getByTestId("exercise-type-input")).toBeVisible();
    await expect(page.getByTestId("connection-status")).toHaveText("Live");
    await expect(page.getByTestId("exercise-button")).toHaveText("Start");
  });

  test("does not stop on brief tap of stop button", async ({ page }) => {
    await startExercise(page);
    await page.waitForTimeout(500);

    await page.getByTestId("stop-button").click();
    await expect(page.getByTestId("connection-status")).toHaveText("Recording");
    await expect(page.getByTestId("exercise-button")).toHaveText("Pause");
  });

  test("cannot start exercise without connection", async ({ page }) => {
    await page.getByTestId("disconnect-button").click();
    await expect(page.getByTestId("exercise-button")).toBeDisabled();
  });

  test("pauses exercise when disconnecting mid-session", async ({ page }) => {
    await startExercise(page);
    await page.waitForTimeout(1000);

    await page.getByTestId("disconnect-button").click();
    await expect(page.getByTestId("connection-status")).toHaveText("Disconnected");
  });
});

test.describe("Exercise type picker after stop", () => {
  test.beforeEach(async ({ page }) => {
    await clearAppStorage(page);
    await connectSimulatedMonitor(page);
    await startExercise(page);
    await page.waitForTimeout(1500);
    await stopExercise(page);
  });

  test("saves exercise type from post-workout picker", async ({ page }) => {
    await page.getByTestId("exercise-type-input").fill("LISS");
    await page.getByTestId("exercise-type-save").click();

    await expect(page.getByTestId("log-entries")).toContainText("LISS");
    await expect(page.getByTestId("exercise-type-input")).toHaveValue("LISS");
  });

  test("skips exercise type picker", async ({ page }) => {
    await page.getByTestId("exercise-type-skip").click();

    await expect(page.getByTestId("exercise-type-skip")).toHaveCount(0);
    await expect(page.getByTestId("exercise-type-input")).toHaveValue("");
  });
});
