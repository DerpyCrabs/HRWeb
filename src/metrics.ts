type Zone = {
  id: number;
  min: number;
  max: number;
};

type Reading = {
  bpm: number;
  time: number;
};

export type ExerciseLogEntry = {
  id: string;
  startedAt: number;
  stoppedAt: number;
  durationMs: number;
  readings: Reading[];
  targetZoneId: number;
  zones: Zone[];
  exerciseType?: string;
  hiddenAt?: number;
};

export type MetricGrouping = "week" | "month";

export type TrendPoint = {
  label: string;
  value: number;
  timestamp: number;
};

export type WorkoutBarPoint = {
  label: string;
  value: number;
  timestamp: number;
};

export type ExerciseMetricKind = "zone2" | "hrr" | "trimp";

const LISS_PATTERN = /liss|низкоинтенсив|аэроб|steady/i;
const STRENGTH_PATTERN = /strength|силов|weights?|weight/i;
const HIIT_PATTERN = /hiit|интервал|tabata|высокoint/i;

export function matchesLissType(type: string | undefined): boolean {
  return Boolean(type && LISS_PATTERN.test(type.trim()));
}

export function matchesStrengthType(type: string | undefined): boolean {
  return Boolean(type && STRENGTH_PATTERN.test(type.trim()));
}

export function matchesHiitType(type: string | undefined): boolean {
  return Boolean(type && HIIT_PATTERN.test(type.trim()));
}

export function matchesHrrType(type: string | undefined): boolean {
  return matchesStrengthType(type) || matchesHiitType(type);
}

export function getMetricsForType(type: string | undefined): ExerciseMetricKind[] {
  if (matchesLissType(type)) return ["zone2", "trimp"];
  if (matchesHrrType(type)) return ["hrr", "trimp"];
  return ["trimp"];
}

function getZoneForRate(zones: Zone[], bpm: number): Zone | null {
  return zones.find((zone) => bpm >= zone.min && bpm <= zone.max) || null;
}

function getZoneDurations(readings: Reading[], zones: Zone[], durationMs: number): Map<number, number> {
  const zoneDurations = new Map(zones.map((zone) => [zone.id, 0]));
  const fallbackInterval = readings.length > 1 ? Math.max(0, readings[1]!.time - readings[0]!.time) : 0;

  readings.forEach((reading, index) => {
    const nextReading = readings[index + 1];
    const nextTime = nextReading?.time ?? Math.max(reading.time, durationMs || reading.time + fallbackInterval);
    const intervalMs = Math.max(0, nextTime - reading.time);
    const zone = getZoneForRate(zones, reading.bpm);
    if (zone) {
      zoneDurations.set(zone.id, (zoneDurations.get(zone.id) || 0) + intervalMs);
    }
  });

  return zoneDurations;
}

export function calculateZone2Adherence(entry: ExerciseLogEntry): number | null {
  if (!entry.readings.length || entry.durationMs <= 0) return null;

  const zoneDurations = getZoneDurations(entry.readings, entry.zones, entry.durationMs);
  const zone2Ms = zoneDurations.get(2) || 0;
  return Math.round((zone2Ms / entry.durationMs) * 100);
}

export function calculateTrimp(entry: ExerciseLogEntry): number {
  if (!entry.readings.length) return 0;

  const zoneDurations = getZoneDurations(entry.readings, entry.zones, entry.durationMs);
  const trimp = [...zoneDurations.entries()].reduce((sum, [zoneId, durationMs]) => {
    return sum + (durationMs / 60_000) * zoneId;
  }, 0);

  return Math.round(trimp * 10) / 10;
}

const HRR_RECOVERY_MS = 60_000;
const HRR_MIN_PEAK_BPM = 120;
const HRR_MIN_PEAK_GAP_MS = 30_000;

function readingAtOrAfter(readings: Reading[], targetTime: number): Reading | null {
  for (const reading of readings) {
    if (reading.time >= targetTime) {
      return reading;
    }
  }
  return readings[readings.length - 1] || null;
}

export function calculateWorkoutHrr(entry: ExerciseLogEntry): number | null {
  const readings = entry.readings;
  if (readings.length < 3) return null;

  const events: Array<{ peakTime: number; dropBpm: number }> = [];

  for (let index = 1; index < readings.length - 1; index += 1) {
    const previous = readings[index - 1]!;
    const current = readings[index]!;
    const next = readings[index + 1]!;

    if (current.bpm < previous.bpm || current.bpm <= next.bpm || current.bpm < HRR_MIN_PEAK_BPM) {
      continue;
    }

    const recoveryReading = readingAtOrAfter(readings, current.time + HRR_RECOVERY_MS);
    if (!recoveryReading || recoveryReading.time < current.time + HRR_RECOVERY_MS * 0.9) {
      continue;
    }

    const dropBpm = current.bpm - recoveryReading.bpm;
    const lastEvent = events[events.length - 1];

    if (lastEvent && current.time - lastEvent.peakTime < HRR_MIN_PEAK_GAP_MS) {
      if (dropBpm > lastEvent.dropBpm) {
        events[events.length - 1] = { peakTime: current.time, dropBpm };
      }
      continue;
    }

    events.push({ peakTime: current.time, dropBpm });
  }

  if (!events.length) return null;
  return Math.round(events.reduce((sum, event) => sum + event.dropBpm, 0) / events.length);
}

function startOfWeek(timestamp: number): Date {
  const date = new Date(timestamp);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return date;
}

function startOfMonth(timestamp: number): Date {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date;
}

function formatGroupLabel(date: Date, grouping: MetricGrouping): string {
  if (grouping === "month") {
    return new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" }).format(date);
  }

  const end = new Date(date);
  end.setDate(end.getDate() + 6);

  if (date.getMonth() === end.getMonth()) {
    const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
    return `${month} ${date.getDate()}–${end.getDate()}`;
  }

  const startLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  const endLabel = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(end);
  return `${startLabel}–${endLabel}`;
}

function groupAverageTrend(
  entries: ExerciseLogEntry[],
  valueForEntry: (entry: ExerciseLogEntry) => number | null,
  grouping: MetricGrouping,
): TrendPoint[] {
  const buckets = new Map<number, { sum: number; count: number; date: Date }>();

  entries.forEach((entry) => {
    const value = valueForEntry(entry);
    if (value === null) return;

    const bucketDate = grouping === "month" ? startOfMonth(entry.stoppedAt) : startOfWeek(entry.stoppedAt);
    const key = bucketDate.getTime();
    const bucket = buckets.get(key) || { sum: 0, count: 0, date: bucketDate };
    bucket.sum += value;
    bucket.count += 1;
    buckets.set(key, bucket);
  });

  return [...buckets.values()]
    .sort((first, second) => first.date.getTime() - second.date.getTime())
    .map((bucket) => ({
      label: formatGroupLabel(bucket.date, grouping),
      value: Math.round((bucket.sum / bucket.count) * 10) / 10,
      timestamp: bucket.date.getTime(),
    }));
}

export function buildZone2Trend(entries: ExerciseLogEntry[], grouping: MetricGrouping): TrendPoint[] {
  return groupAverageTrend(entries, calculateZone2Adherence, grouping);
}

export function buildHrrTrend(entries: ExerciseLogEntry[], grouping: MetricGrouping): TrendPoint[] {
  return groupAverageTrend(entries, calculateWorkoutHrr, grouping);
}

export function buildTrimpBars(entries: ExerciseLogEntry[], limit = 20): WorkoutBarPoint[] {
  return [...entries]
    .sort((first, second) => first.stoppedAt - second.stoppedAt)
    .slice(-limit)
    .map((entry) => ({
      label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(entry.stoppedAt)),
      value: calculateTrimp(entry),
      timestamp: entry.stoppedAt,
    }));
}

export function groupEntriesByType(entries: ExerciseLogEntry[]): Array<{ type: string; entries: ExerciseLogEntry[] }> {
  const groups = new Map<string, ExerciseLogEntry[]>();

  entries.forEach((entry) => {
    const key = entry.exerciseType?.trim() || "__untyped__";
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  });

  return [...groups.entries()]
    .sort(([first], [second]) => {
      if (first === "__untyped__") return 1;
      if (second === "__untyped__") return -1;
      return first.localeCompare(second);
    })
    .map(([type, typeEntries]) => ({
      type: type === "__untyped__" ? "Untyped" : type,
      entries: typeEntries.sort((first, second) => second.stoppedAt - first.stoppedAt),
    }));
}
