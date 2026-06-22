import type { Page } from "@playwright/test";

export const ZONES_STORAGE_KEY = "heartRateExercise.zones.v1";
export const EXERCISE_LOG_STORAGE_KEY = "heartRateExercise.log.v1";

export type TestReading = { bpm: number; time: number };

export type TestLogEntry = {
  id: string;
  startedAt: number;
  stoppedAt: number;
  durationMs: number;
  readings: TestReading[];
  targetZoneId: number;
  zones: Array<{ id: number; name: string; min: number; max: number; color: string }>;
  exerciseType?: string;
};

const DEFAULT_ZONES = [
  { id: 1, name: "Zone 1", min: 90, max: 110, color: "#2a9d8f" },
  { id: 2, name: "Zone 2", min: 111, max: 130, color: "#70b62c" },
  { id: 3, name: "Zone 3", min: 131, max: 150, color: "#f0b429" },
  { id: 4, name: "Zone 4", min: 151, max: 170, color: "#f77f00" },
  { id: 5, name: "Zone 5", min: 171, max: 190, color: "#d9184b" },
];

export async function clearAppStorage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([zonesKey, logKey]) => {
      localStorage.removeItem(zonesKey);
      localStorage.removeItem(logKey);
    },
    [ZONES_STORAGE_KEY, EXERCISE_LOG_STORAGE_KEY],
  );
  await page.reload();
}

export async function connectSimulatedMonitor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as Window & { __HRWEB_TEST__?: { connectSimulated: () => void } }).__HRWEB_TEST__;
    if (!api) {
      throw new Error("Test API unavailable. Run against the Vite dev server.");
    }
    api.connectSimulated();
  });
}

export async function disconnectSimulatedMonitor(page: Page): Promise<void> {
  await page.getByTestId("disconnect-button").click();
}

export async function holdButton(page: Page, testId: string, holdMs = 1100): Promise<void> {
  const button = page.getByTestId(testId);
  await button.dispatchEvent("pointerdown");
  await page.waitForTimeout(holdMs);
  await button.dispatchEvent("pointerup");
}

export async function seedExerciseLog(page: Page, entries: TestLogEntry[]): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([logKey, payload]) => {
      localStorage.setItem(logKey, JSON.stringify({ version: 2, entries: payload }));
    },
    [EXERCISE_LOG_STORAGE_KEY, entries] as const,
  );
  await page.reload();
}

export function makeLogEntry(overrides: Partial<TestLogEntry> = {}): TestLogEntry {
  const stoppedAt = overrides.stoppedAt ?? Date.now();
  const durationMs = overrides.durationMs ?? 120_000;
  const startedAt = overrides.startedAt ?? stoppedAt - durationMs;

  return {
    id: overrides.id ?? `test-${stoppedAt}`,
    startedAt,
    stoppedAt,
    durationMs,
    readings: overrides.readings ?? [
      { bpm: 100, time: 0 },
      { bpm: 120, time: 30_000 },
      { bpm: 125, time: 60_000 },
      { bpm: 115, time: 90_000 },
      { bpm: 110, time: 120_000 },
    ],
    targetZoneId: overrides.targetZoneId ?? 3,
    zones: overrides.zones ?? DEFAULT_ZONES.map((zone) => ({ ...zone })),
    exerciseType: overrides.exerciseType,
  };
}

export async function startExercise(page: Page): Promise<void> {
  await page.getByTestId("exercise-button").click();
}

export async function stopExercise(page: Page): Promise<void> {
  await holdButton(page, "stop-button");
}
