import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import MetricsView from "./MetricsView";
import { calculateWorkoutHrr, matchesHrrType } from "./metrics";

type Zone = {
  id: number;
  name: string;
  min: number;
  max: number;
  color: string;
};

type ZoneState = {
  zones: Zone[];
  targetZoneId: number;
};

type StoredZoneState = {
  zones?: Array<Partial<Pick<Zone, "min" | "max">>>;
  targetZoneId?: number;
};

type Reading = {
  bpm: number;
  time: number;
};

type ChartRange = {
  id: string;
  label: string;
  startMs: number;
  endMs: number;
};

type ExerciseLogEntry = {
  id: string;
  startedAt: number;
  stoppedAt: number;
  durationMs: number;
  readings: Reading[];
  targetZoneId: number;
  zones: Zone[];
  exerciseType?: string;
  ranges: ChartRange[];
  hiddenAt?: number;
};

type StoredExerciseLog = {
  version?: number;
  entries?: unknown;
};

type StatusMode = "muted" | "warn" | "live";
type ExerciseState = "idle" | "running" | "paused" | "stopped";
type DetailView = "live" | "log" | "metrics";

type StatValue = number | "--";

type ZoneTimeStat = {
  zone: Zone;
  durationMs: number;
  percent: number;
};

type HeartRateStats = {
  min: StatValue;
  avg: StatValue;
  max: StatValue;
  zoneTimes: ZoneTimeStat[];
};

type HeartRateCharacteristic = EventTarget & {
  value?: DataView;
  startNotifications(): Promise<HeartRateCharacteristic>;
  stopNotifications(): Promise<HeartRateCharacteristic>;
};

type HeartRateService = {
  getCharacteristic(characteristic: string): Promise<HeartRateCharacteristic>;
};

type HeartRateServer = {
  getPrimaryService(service: string): Promise<HeartRateService>;
};

type HeartRateDevice = EventTarget & {
  gatt?: {
    connected: boolean;
    connect(): Promise<HeartRateServer>;
    disconnect(): void;
  };
};

type BluetoothNavigator = Navigator & {
  bluetooth: {
    requestDevice(options: {
      filters: Array<{ services: string[] }>;
      optionalServices: string[];
    }): Promise<HeartRateDevice>;
  };
};

const HEART_RATE_SERVICE = "heart_rate";
const HEART_RATE_MEASUREMENT = "heart_rate_measurement";
const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
const ZONES_STORAGE_KEY = "heartRateExercise.zones.v1";
const EXERCISE_LOG_STORAGE_KEY = "heartRateExercise.log.v1";
const STOP_HOLD_MS = 1000;
const DEFAULT_ZONES: Zone[] = [
  { id: 1, name: "Zone 1", min: 90, max: 110, color: "#2a9d8f" },
  { id: 2, name: "Zone 2", min: 111, max: 130, color: "#70b62c" },
  { id: 3, name: "Zone 3", min: 131, max: 150, color: "#f0b429" },
  { id: 4, name: "Zone 4", min: 151, max: 170, color: "#f77f00" },
  { id: 5, name: "Zone 5", min: 171, max: 190, color: "#d9184b" },
];

const cardClass = "rounded-lg border border-[#dbe2dc]/90 bg-white/95 shadow-[0_18px_45px_rgba(24,31,27,0.11)]";
const detailContentClass = (mobile: boolean) =>
  `mt-5 min-h-[617px] ${mobile ? "!mt-2 !min-h-[520px]" : ""}`;
const metricsContentClass = (mobile: boolean) =>
  mobile
    ? `${detailContentClass(mobile)} min-w-0 overflow-x-hidden`
    : `${detailContentClass(mobile)} max-h-[617px] min-w-0 overflow-y-auto`;
const primaryButtonClass = "flex min-h-[46px] cursor-pointer items-center justify-center rounded-lg border border-transparent bg-[#d9184b] px-4 text-center text-[1rem] font-extrabold leading-none text-white hover:bg-[#a80f37] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "flex min-h-[46px] cursor-pointer items-center justify-center rounded-lg border border-[#dbe2dc] bg-white px-4 text-center text-[0.95rem] font-bold leading-none text-[#172019] hover:not-disabled:border-[#aebcaf] hover:not-disabled:bg-[#fbfcfb] disabled:cursor-not-allowed disabled:border-[#e5ebe6] disabled:bg-[#fbfcfb] disabled:text-[#9aa39c]";
const statTileClass = "min-w-16 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] px-2.5 py-2 text-right";

function normalizeZones(nextZones: Zone[]): Zone[] {
  const normalized = nextZones.map((zone) => ({
    ...zone,
    min: Math.max(30, Math.min(240, Math.round(zone.min))),
    max: Math.max(30, Math.min(240, Math.round(zone.max))),
  }));

  for (let index = 0; index < normalized.length; index += 1) {
    if (index > 0) {
      normalized[index]!.min = normalized[index - 1]!.max + 1;
    }

    if (normalized[index]!.max < normalized[index]!.min) {
      normalized[index]!.max = normalized[index]!.min;
    }
  }

  return normalized;
}

function loadZoneState(): ZoneState {
  try {
    const stored = JSON.parse(localStorage.getItem(ZONES_STORAGE_KEY) || "null") as StoredZoneState | null;
    if (!stored?.zones?.length) {
      return { zones: normalizeZones(DEFAULT_ZONES), targetZoneId: 3 };
    }

    const storedZones = stored.zones;

    return {
      zones: normalizeZones(DEFAULT_ZONES.map((zone, index) => ({
        ...zone,
        min: Number(storedZones[index]?.min) || zone.min,
        max: Number(storedZones[index]?.max) || zone.max,
      }))),
      targetZoneId: Number(stored.targetZoneId) || 3,
    };
  } catch {
    return { zones: normalizeZones(DEFAULT_ZONES), targetZoneId: 3 };
  }
}

function isReading(value: unknown): value is Reading {
  const reading = value as Reading;
  return Number.isFinite(reading?.bpm) && Number.isFinite(reading?.time);
}

function isZone(value: unknown): value is Zone {
  const zone = value as Zone;
  return (
    Number.isFinite(zone?.id) &&
    typeof zone?.name === "string" &&
    Number.isFinite(zone?.min) &&
    Number.isFinite(zone?.max) &&
    typeof zone?.color === "string"
  );
}

function sanitizeLogEntry(value: unknown): ExerciseLogEntry | null {
  const entry = value as ExerciseLogEntry;
  if (
    typeof entry?.id !== "string" ||
    !Number.isFinite(entry.startedAt) ||
    !Number.isFinite(entry.stoppedAt) ||
    !Number.isFinite(entry.durationMs) ||
    !Array.isArray(entry.readings)
  ) {
    return null;
  }

  const entryZones = Array.isArray(entry.zones) && entry.zones.every(isZone) ? entry.zones : DEFAULT_ZONES;
  const targetZoneId = Number.isFinite(entry.targetZoneId) ? entry.targetZoneId : 3;

  return {
    id: entry.id,
    startedAt: entry.startedAt,
    stoppedAt: entry.stoppedAt,
    durationMs: Math.max(0, entry.durationMs),
    readings: entry.readings.filter(isReading).map((reading) => ({
      bpm: Math.round(reading.bpm),
      time: Math.max(0, Math.round(reading.time)),
    })),
    targetZoneId,
    zones: normalizeZones(entryZones.map((zone) => ({ ...zone }))),
    exerciseType: typeof entry.exerciseType === "string" && entry.exerciseType.trim() ? entry.exerciseType.trim() : undefined,
    ranges: Array.isArray(entry.ranges)
      ? entry.ranges.filter((range): range is ChartRange => {
          const item = range as ChartRange;
          return typeof item.id === "string" && typeof item.label === "string" &&
            Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.startMs < item.endMs;
        }).sort((a, b) => a.startMs - b.startMs)
      : [],
    hiddenAt: Number.isFinite(entry.hiddenAt) ? entry.hiddenAt : undefined,
  };
}

function normalizeExerciseType(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function loadExerciseLog(): ExerciseLogEntry[] {
  try {
    const stored = JSON.parse(localStorage.getItem(EXERCISE_LOG_STORAGE_KEY) || "null") as StoredExerciseLog | ExerciseLogEntry[] | null;
    const entries = Array.isArray(stored) ? stored : stored?.entries;
    if (!Array.isArray(entries)) return [];

    return entries
      .map(sanitizeLogEntry)
      .filter((entry): entry is ExerciseLogEntry => Boolean(entry))
      .sort((first, second) => second.stoppedAt - first.stoppedAt);
  } catch {
    return [];
  }
}

function saveExerciseLog(entries: ExerciseLogEntry[]): void {
  localStorage.setItem(
    EXERCISE_LOG_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      entries,
    }),
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatZoneDuration(ms: number): string {
  if (ms <= 0) return "0:00";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function parseHeartRateMeasurement(dataView: DataView): number {
  const flags = dataView.getUint8(0);
  const isUint16 = Boolean(flags & 0x01);
  return isUint16 ? dataView.getUint16(1, true) : dataView.getUint8(1);
}

function getZoneForRate(zones: Zone[], bpm: number): Zone | null {
  return zones.find((zone) => bpm >= zone.min && bpm <= zone.max) || null;
}

function saveZoneState(zones: Zone[], targetZoneId: number): void {
  localStorage.setItem(
    ZONES_STORAGE_KEY,
    JSON.stringify({
      zones: zones.map(({ id, min, max }) => ({ id, min, max })),
      targetZoneId,
    }),
  );
}

function getHeartRateStats(readings: Reading[], zones: Zone[], durationMs: number): HeartRateStats {
  const values = readings.map((point) => point.bpm);
  const emptyZoneTimes = zones.map((zone) => ({ zone, durationMs: 0, percent: 0 }));

  if (!values.length) {
    return { min: "--", avg: "--", max: "--", zoneTimes: emptyZoneTimes };
  }

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

  const trackedDurationMs = [...zoneDurations.values()].reduce((sum, value) => sum + value, 0);

  return {
    min: Math.min(...values),
    avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    max: Math.max(...values),
    zoneTimes: zones.map((zone) => {
      const zoneDurationMs = zoneDurations.get(zone.id) || 0;
      return {
        zone,
        durationMs: zoneDurationMs,
        percent: trackedDurationMs > 0 ? Math.round((zoneDurationMs / trackedDurationMs) * 100) : 0,
      };
    }),
  };
}

type HeartChartProps = {
  readings: Accessor<Reading[]>;
  zones: Accessor<Zone[]>;
  targetZoneId: Accessor<number>;
  mobile: Accessor<boolean>;
  showTimeAxis?: Accessor<boolean>;
  durationMs?: Accessor<number>;
  ranges?: Accessor<ChartRange[]>;
  selectable?: Accessor<boolean>;
  onRangeSelected?(startMs: number, endMs: number): void;
  onRangeClick?(range: ChartRange): void;
};

function HeartChart(props: HeartChartProps): JSX.Element {
  let canvas!: HTMLCanvasElement;
  let dragStart: number | null = null;
  const [draft, setDraft] = createSignal<{ startMs: number; endMs: number } | null>(null);

  const timeAtPointer = (event: PointerEvent): number => {
    const values = props.readings();
    const first = values[0]?.time ?? 0;
    const last = values[values.length - 1]?.time ?? first;
    const rect = canvas.getBoundingClientRect();
    const mobile = props.mobile();
    const padding = mobile ? Math.max(20, rect.width * 0.035) : Math.max(34, rect.width * 0.04);
    const left = mobile ? (props.showTimeAxis?.() ? padding * 1.4 : 0) : padding;
    const right = mobile ? (props.showTimeAxis?.() ? padding * 0.55 : 0) : padding * 0.5;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - left) / Math.max(1, rect.width - left - right)));
    return Math.round(first + ratio * Math.max(0, last - first));
  };

  const redraw = () => drawChart(canvas, props.readings(), props.zones(), props.targetZoneId(), props.mobile(), props.showTimeAxis?.() ?? false, props.durationMs?.() ?? 0, props.ranges?.() ?? [], draft());

  createEffect(() => {
    const readings = props.readings();
    const zones = props.zones();
    const targetZoneId = props.targetZoneId();
    const durationMs = props.durationMs?.() ?? 0;
    props.ranges?.();
    draft();
    drawChart(canvas, readings, zones, targetZoneId, props.mobile(), props.showTimeAxis?.() ?? false, durationMs, props.ranges?.() ?? [], draft());
  });

  onMount(() => {
    const resize = redraw;
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));
  });

  return (
    <div class={`mt-5 w-full aspect-[16/9] min-h-[360px] ${props.mobile() ? "!mt-2" : ""}`}>
      <canvas ref={canvas} data-testid="heart-chart" class={`block h-full w-full rounded-lg border border-[#dbe2dc] bg-[#fffdfa] ${props.selectable?.() ? "cursor-crosshair touch-none" : ""}`} width="1200" height="520" aria-label="Heart rate line chart"
        onPointerDown={(event) => { if (!props.selectable?.() || props.readings().length < 2) return; canvas.setPointerCapture(event.pointerId); dragStart = timeAtPointer(event); setDraft({ startMs: dragStart, endMs: dragStart }); }}
        onPointerMove={(event) => { if (dragStart === null) return; setDraft({ startMs: Math.min(dragStart, timeAtPointer(event)), endMs: Math.max(dragStart, timeAtPointer(event)) }); }}
        onPointerUp={(event) => { if (dragStart === null) return; const end = timeAtPointer(event); const start = Math.min(dragStart, end); const finish = Math.max(dragStart, end); dragStart = null; setDraft(null); if (finish - start >= 1000) props.onRangeSelected?.(start, finish); else { const range = props.ranges?.().find((item) => end >= item.startMs && end <= item.endMs); if (range) props.onRangeClick?.(range); } }}
        onPointerCancel={() => { dragStart = null; setDraft(null); }} />
    </div>
  );
}

function chartFont(cssWidth: number, ratio: number, minPx: number, divisor: number, weight = 400): string {
  const size = Math.max(minPx, Math.round(cssWidth / divisor));
  return `${weight} ${size * ratio}px system-ui, sans-serif`;
}

function chartAxisLabelPx(cssWidth: number, mobile: boolean): number {
  return Math.max(mobile ? 11 : 12, Math.round(cssWidth / (mobile ? 58 : 52)));
}

const NICE_TIME_STEPS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000,
  60 * 60_000, 2 * 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000,
];

function getNiceTimeStep(durationMs: number, maxIntervals: number): number {
  const minimumStep = Math.max(1, durationMs) / Math.max(1, maxIntervals);
  return NICE_TIME_STEPS_MS.find((step) => step >= minimumStep)
    ?? Math.ceil(minimumStep / (60 * 60_000)) * 60 * 60_000;
}

function formatChartTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function drawChart(
  canvas: HTMLCanvasElement | undefined,
  readings: Reading[],
  zones: Zone[],
  targetZoneId: number,
  mobile = false,
  showTimeAxis = false,
  durationMs = 0,
  ranges: ChartRange[] = [],
  draft: { startMs: number; endMs: number } | null = null,
): void {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx || !zones.length) return;

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = rect.width;
  const width = Math.round(cssWidth * ratio);
  const height = Math.round(rect.height * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const basePadding = mobile ? Math.max(20, Math.round(cssWidth * 0.035)) : Math.max(34, Math.round(cssWidth * 0.04));
  const xLabelPx = chartAxisLabelPx(cssWidth, mobile);
  const padding = basePadding * ratio;
  const left = mobile ? (showTimeAxis ? padding * 1.4 : 0) : padding;
  const right = mobile ? (showTimeAxis ? padding * 0.55 : 0) : padding * 0.5;
  const bottomPadding = mobile
    ? (showTimeAxis ? (basePadding + xLabelPx * 1.55) * ratio : 0)
    : (showTimeAxis ? (basePadding + xLabelPx * 1.55) * ratio : padding * 1.1);
  const top = mobile ? 0 : padding * 0.55;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottomPadding;
  const bottom = top + plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdfa";
  ctx.fillRect(0, 0, width, height);

  const zoneMins = zones.map((zone) => zone.min);
  const zoneMaxes = zones.map((zone) => zone.max);
  const values = readings.map((point) => point.bpm);
  const minValue = values.length ? Math.min(...values, 50) : 50;
  const maxValue = values.length ? Math.max(...values, 170) : 170;
  const chartMin = mobile ? Math.min(minValue, ...zoneMins) : Math.min(minValue, ...zoneMins, 50);
  const chartMax = mobile ? Math.max(maxValue, ...zoneMaxes) : Math.max(maxValue, ...zoneMaxes, 170);
  const span = Math.max(20, chartMax - chartMin);
  const yMin = mobile ? chartMin : Math.max(35, Math.floor((chartMin - span * 0.08) / 5) * 5);
  const yMax = mobile ? chartMax : Math.ceil((chartMax + span * 0.08) / 5) * 5;
  const yForBpm = (bpm: number) => bottom - ((bpm - yMin) / Math.max(1, yMax - yMin)) * plotHeight;

  zones.forEach((zone, index) => {
    const previousZone = zones[index - 1];
    const nextZone = zones[index + 1];
    const lowerBoundary = previousZone ? (previousZone.max + zone.min) / 2 : zone.min;
    const upperBoundary = nextZone ? (zone.max + nextZone.min) / 2 : zone.max;
    const bandTop = Math.max(top, Math.floor(yForBpm(upperBoundary)));
    const bandBottom = Math.min(bottom, Math.ceil(yForBpm(lowerBoundary)));
    const isTarget = zone.id === targetZoneId;

    ctx.fillStyle = `${zone.color}${isTarget ? "34" : "14"}`;
    ctx.fillRect(left, bandTop, plotWidth, Math.max(1, bandBottom - bandTop + 1));

    if (isTarget && !mobile) {
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = Math.max(2, Math.round(width / 720));
      ctx.strokeRect(left, bandTop, plotWidth, Math.max(1, bandBottom - bandTop));
    }
  });

  if (!mobile) {
    ctx.fillStyle = "#617066";
    ctx.font = chartFont(cssWidth, ratio, 11, 88);
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";

    const boundaryLabels = [
      { label: zones[0]!.min, value: zones[0]!.min },
      ...zones.slice(0, -1).map((zone, index) => {
        const nextZone = zones[index + 1]!;
        return { label: zone.max, value: (zone.max + nextZone.min) / 2 };
      }),
      { label: zones[zones.length - 1]!.max, value: zones[zones.length - 1]!.max },
    ];

    boundaryLabels.forEach((boundary) => {
      ctx.fillText(String(boundary.label), left - 8 * ratio, yForBpm(boundary.value));
    });

    ctx.textAlign = "start";
  }

  const firstTime = readings[0]?.time ?? 0;
  const lastReadingTime = readings[readings.length - 1]?.time ?? 0;
  const minWindowMs = durationMs < 60_000 ? Math.max(durationMs, 5_000) : 60_000;
  const axisMaxMs = Math.max(minWindowMs, durationMs, lastReadingTime, 1);
  const xForPoint = (point: Reading) => left + ((point.time - firstTime) / axisMaxMs) * plotWidth;
  const xForTime = (time: number) => left + ((time - firstTime) / axisMaxMs) * plotWidth;

  [...ranges, ...(draft ? [{ id: "draft", label: "New range", ...draft }] : [])].forEach((range, index) => {
    const startX = xForTime(range.startMs);
    const endX = xForTime(range.endMs);
    ctx.fillStyle = range.id === "draft" ? "rgba(217,24,75,.14)" : `hsla(${(index * 67 + 205) % 360},65%,45%,.12)`;
    ctx.fillRect(startX, top, Math.max(1, endX - startX), plotHeight);
    ctx.strokeStyle = range.id === "draft" ? "#d9184b" : `hsl(${(index * 67 + 205) % 360},55%,38%)`;
    ctx.lineWidth = Math.max(1, Math.round(width / 900));
    ctx.strokeRect(startX, top, Math.max(1, endX - startX), plotHeight);
    ctx.save();
    ctx.beginPath(); ctx.rect(startX, top, Math.max(1, endX - startX), plotHeight); ctx.clip();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = chartFont(cssWidth, ratio, 10, 105, 700);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(range.label, startX + 5, top + 5);
    ctx.restore();
  });

  if (showTimeAxis) {
    const maxIntervals = mobile ? 4 : Math.max(5, Math.min(10, Math.floor(cssWidth / 60)));
    const tickStepMs = getNiceTimeStep(axisMaxMs, maxIntervals);
    const tickTimes: number[] = [];
    for (let tickTime = 0; tickTime <= axisMaxMs; tickTime += tickStepMs) {
      tickTimes.push(tickTime);
    }
    const axisTop = bottom + Math.max(4 * ratio, padding * 0.18);
    const plotRight = left + plotWidth;

    ctx.strokeStyle = "#cbd5ce";
    ctx.lineWidth = Math.max(1, Math.round(width / 1100));
    ctx.beginPath();
    ctx.moveTo(left, bottom + 0.5);
    ctx.lineTo(plotRight, bottom + 0.5);
    ctx.stroke();

    ctx.fillStyle = "#617066";
    ctx.font = chartFont(cssWidth, ratio, 12, mobile ? 58 : 52, 600);
    ctx.textBaseline = "top";

    canvas.dataset.timeAxisStepMs = String(tickStepMs);
    canvas.dataset.timeAxisLabels = tickTimes.map(formatChartTime).join(",");

    tickTimes.forEach((tickTime, index) => {
      const x = left + (tickTime / axisMaxMs) * plotWidth;
      const label = formatChartTime(tickTime);

      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.lineTo(x, bottom + Math.max(4 * ratio, padding * 0.18));
      ctx.stroke();

      if (index === 0) {
        ctx.textAlign = "left";
        ctx.fillText(label, left, axisTop);
      } else if (index === tickTimes.length - 1 && tickTime === axisMaxMs) {
        ctx.textAlign = "right";
        ctx.fillText(label, plotRight, axisTop);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(label, x, axisTop);
      }
    });
  }

  if (readings.length < 2) return;

  const targetZone = zones.find((zone) => zone.id === targetZoneId) || zones[0]!;

  ctx.lineWidth = Math.max(3, Math.round(width / 360));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1]!;
    const current = readings[index]!;
    const zone = getZoneForRate(zones, current.bpm);
    const isTarget = current.bpm >= targetZone.min && current.bpm <= targetZone.max;

    ctx.beginPath();
    ctx.moveTo(xForPoint(previous), yForBpm(previous.bpm));
    ctx.lineTo(xForPoint(current), yForBpm(current.bpm));
    ctx.strokeStyle = isTarget ? targetZone.color : zone?.color || "#172019";
    ctx.globalAlpha = isTarget ? 1 : 0.72;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const latest = readings[readings.length - 1]!;
  const latestX = xForPoint(latest);
  const latestY = yForBpm(latest.bpm);
  const latestZone = getZoneForRate(zones, latest.bpm);

  ctx.fillStyle = latestZone?.color || "#172019";
  ctx.beginPath();
  ctx.arc(latestX, latestY, Math.max(5, Math.round(width / 170)), 0, Math.PI * 2);
  ctx.fill();
}

function RangeStats(props: { ranges: Accessor<ChartRange[]>; readings: Accessor<Reading[]>; onDelete(id: string): void }): JSX.Element {
  const stats = (range: ChartRange) => {
    const points = props.readings().filter((point) => point.time >= range.startMs && point.time <= range.endMs);
    if (!points.length) return null;
    let rise = 0;
    let fall = 0;
    for (let index = 1; index < points.length; index += 1) {
      const change = points[index]!.bpm - points[index - 1]!.bpm;
      rise = Math.max(rise, change);
      fall = Math.min(fall, change);
    }
    const values = points.map((point) => point.bpm);
    return { start: values[0]!, end: values[values.length - 1]!, delta: values[values.length - 1]! - values[0]!, min: Math.min(...values), max: Math.max(...values), avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), rise, fall };
  };

  return <Show when={props.ranges().length}>
    <div class="mt-3 grid gap-2" aria-label="Labeled chart ranges">
      <For each={props.ranges()}>{(range) => {
        const values = () => stats(range);
        return <div class="rounded-lg border border-[#dbe2dc] bg-white p-3">
          <div class="flex items-center justify-between gap-2">
            <div><strong>{range.label}</strong><span class="ml-2 text-xs font-bold text-[#617066]">{formatDuration(range.startMs)}–{formatDuration(range.endMs)}</span></div>
            <button class="rounded px-2 py-1 text-xs font-bold text-[#d9184b] hover:bg-[#d9184b]/10" type="button" onClick={() => props.onDelete(range.id)}>Delete</button>
          </div>
          <Show when={values()}>{(value) => <div class="mt-2 grid grid-cols-4 gap-2 text-sm max-[700px]:grid-cols-2">
            <span><b>{value().start}→{value().end}</b><small class="block text-[#617066]">Start → end</small></span>
            <span><b class={value().delta > 0 ? "text-[#087f5b]" : value().delta < 0 ? "text-[#d9184b]" : ""}>{value().delta > 0 ? "+" : ""}{value().delta} bpm</b><small class="block text-[#617066]">Total change</small></span>
            <span><b>{value().min}/{value().avg}/{value().max}</b><small class="block text-[#617066]">Min / avg / max</small></span>
            <span><b class="text-[#087f5b]">+{value().rise}</b> / <b class="text-[#d9184b]">{value().fall}</b><small class="block text-[#617066]">Max step rise / fall</small></span>
          </div>}</Show>
        </div>;
      }}</For>
    </div>
  </Show>;
}

type ZoneEditorProps = {
  zones: Accessor<Zone[]>;
  targetZoneId: Accessor<number>;
  mobile: Accessor<boolean>;
  onZonesChange(nextZones: Zone[]): void;
  onTargetChange(zoneId: number): void;
};

function ZoneEditor(props: ZoneEditorProps): JSX.Element {
  let trackRef!: HTMLDivElement;
  const minBpm = createMemo(() => props.zones()[0]?.min ?? 30);
  const maxBpm = createMemo(() => props.zones()[props.zones().length - 1]?.max ?? 240);
  const span = createMemo(() => Math.max(1, maxBpm() - minBpm() + 1));

  const setBoundary = (index: number, value: number): void => {
    const nextZones = props.zones().map((zone) => ({ ...zone }));
    const leftZone = nextZones[index];
    const rightZone = nextZones[index + 1];
    if (!leftZone || !rightZone) return;

    const boundary = Math.max(leftZone.min, Math.min(rightZone.max - 1, Math.round(value)));

    leftZone.max = boundary;
    rightZone.min = boundary + 1;
    props.onZonesChange(normalizeZones(nextZones));
  };

  const valueFromPointer = (clientX: number): number => {
    const rect = trackRef.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return minBpm() + ratio * (maxBpm() - minBpm());
  };

  const startDrag = (event: PointerEvent, index: number): void => {
    event.preventDefault();
    setBoundary(index, valueFromPointer(event.clientX));

    const move = (moveEvent: PointerEvent) => setBoundary(index, valueFromPointer(moveEvent.clientX));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  return (
    <div class={`mt-[18px] ${props.mobile() ? "!mt-2.5" : ""}`} aria-labelledby="zones-title">
      <div>
        <Show when={!props.mobile()}>
          <p id="zones-title" class="m-0 mb-1.5 text-[0.77rem] font-bold uppercase tracking-normal text-[#617066]">Training zones</p>
        </Show>
      </div>
      <div class={`mt-3 ${props.mobile() ? "!mt-0.5" : ""}`}>
        <div class="relative pt-0 pb-12">
          <div ref={trackRef} class="flex h-8 overflow-hidden rounded-full border border-[#172019]/20 bg-[#f1f4f1]">
            <For each={props.zones()}>
              {(zone) => (
                <button
                  data-testid={`zone-target-${zone.id}`}
                  class={`min-w-[18px] cursor-pointer border-0 p-0 text-transparent ${zone.id === props.targetZoneId() ? "opacity-100 shadow-[inset_0_0_0_3px_rgba(23,32,25,0.28)]" : "opacity-75"}`}
                  type="button"
                  style={{ background: zone.color, "flex-basis": `${((zone.max - zone.min + 1) / span()) * 100}%` }}
                  onClick={() => props.onTargetChange(zone.id)}
                >
                  {zone.id === props.targetZoneId() ? `${zone.name} target` : zone.name}
                </button>
              )}
            </For>
          </div>
          <For each={props.zones().slice(0, -1)}>
            {(zone, index) => (
              <button
                data-testid={`zone-boundary-${index()}`}
                class="absolute h-10 w-[18px] -translate-x-1/2 cursor-ew-resize touch-none rounded-full border-2 border-white bg-[#172019] text-white shadow-[0_4px_12px_rgba(23,32,25,0.22)]"
                type="button"
                role="slider"
                aria-label={`${zone.name} upper boundary`}
                aria-valuemin={minBpm()}
                aria-valuemax={maxBpm()}
                aria-valuenow={zone.max}
                style={{ left: `${((zone.max - minBpm() + 1) / span()) * 100}%`, top: "-4px" }}
                onPointerDown={(event) => startDrag(event, index())}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                    event.preventDefault();
                    setBoundary(index(), zone.max - 1);
                  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setBoundary(index(), zone.max + 1);
                  }
                }}
              >
                <span class="absolute top-[42px] left-1/2 min-w-[34px] -translate-x-1/2 text-center text-[0.72rem] font-extrabold text-[#617066]">{zone.max}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

type ExerciseTypeInputProps = {
  types: string[];
  value: string;
  listId: string;
  placeholder?: string;
  autofocus?: boolean;
  onInput: (value: string) => void;
  onConfirm: (value: string) => void;
  onSkip?: () => void;
  confirmLabel?: string;
  compact?: boolean;
};

function ExerciseTypeInput(props: ExerciseTypeInputProps) {
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    if (props.autofocus) {
      inputRef?.focus();
    }
  });

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      props.onConfirm(props.value);
    }
  };

  return (
    <div class={`grid gap-2 ${props.compact ? "" : "rounded-lg border border-[#dbe2dc] bg-white p-3"}`}>
      <label class="text-[0.78rem] font-bold text-[#617066]" for={props.listId}>
        Exercise type
      </label>
      <div class="flex items-center gap-2">
        <input
          ref={inputRef}
          id={props.listId}
          data-testid="exercise-type-input"
          class="min-h-9 min-w-0 flex-1 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] px-3 text-[0.9rem] font-semibold text-[#172019] outline-none focus:border-[#d9184b]/45"
          type="text"
          list={`${props.listId}-options`}
          value={props.value}
          placeholder={props.placeholder || "Select or enter type"}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          data-testid="exercise-type-save"
          class={`${primaryButtonClass} !min-h-9 !shrink-0 !px-3 !text-[0.82rem]`}
          type="button"
          onClick={() => props.onConfirm(props.value)}
        >
          {props.confirmLabel || "Save"}
        </button>
        <Show when={props.onSkip}>
          {(skip) => (
            <button data-testid="exercise-type-skip" class={`${secondaryButtonClass} !min-h-9 !shrink-0 !px-3 !text-[0.82rem]`} type="button" onClick={skip()}>
              Skip
            </button>
          )}
        </Show>
      </div>
      <datalist id={`${props.listId}-options`}>
        <For each={props.types}>{(type) => <option value={type} />}</For>
      </datalist>
    </div>
  );
}

type ZoneTimeStatsProps = {
  stats: Accessor<HeartRateStats>;
  mobile: Accessor<boolean>;
};

function ZoneTimeStats(props: ZoneTimeStatsProps): JSX.Element {
  return (
    <div class={`mt-3 grid grid-cols-5 gap-2 ${props.mobile() ? "!mt-2 !gap-1" : ""}`} aria-label="Time in heart rate zones" data-testid="zone-time-stats">
      <For each={props.stats().zoneTimes}>
        {(item) => (
          <div class={`min-w-0 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] p-2 ${props.mobile() ? "!p-[5px_6px]" : ""}`}>
            <div class="mb-1 h-1.5 overflow-hidden rounded-full bg-[#e5ebe6]">
              <div class="h-full rounded-full" style={{ width: `${item.percent}%`, background: item.zone.color }} />
            </div>
            <span class={`block truncate font-extrabold tabular-nums ${props.mobile() ? "text-[0.82rem]" : "text-[0.95rem]"}`}>{formatZoneDuration(item.durationMs)}</span>
            <small class={`block truncate font-bold text-[#617066] ${props.mobile() ? "text-[0.62rem]" : "text-[0.72rem]"}`}>{item.zone.name}</small>
          </div>
        )}
      </For>
    </div>
  );
}

export default function App() {
  const initialZoneState = loadZoneState();
  const [connectionStatus, setConnectionStatus] = createSignal("Idle");
  const [statusMode, setStatusMode] = createSignal<StatusMode>("muted");
  const [message, setMessage] = createSignal("");
  const [trend, setTrend] = createSignal("Idle");
  const [readings, setReadings] = createSignal<Reading[]>([]);
  const [latestRate, setLatestRate] = createSignal<number | null>(null);
  const [lastRate, setLastRate] = createSignal<number | null>(null);
  const [exerciseState, setExerciseState] = createSignal<ExerciseState>("idle");
  const [exerciseElapsedMs, setExerciseElapsedMs] = createSignal(0);
  const [exerciseStartedAt, setExerciseStartedAt] = createSignal<number | null>(null);
  const [exerciseSessionStartedAt, setExerciseSessionStartedAt] = createSignal<number | null>(null);
  const [idleStartedAt, setIdleStartedAt] = createSignal<number | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [zones, setZones] = createSignal<Zone[]>(initialZoneState.zones);
  const [targetZoneId, setTargetZoneId] = createSignal(initialZoneState.targetZoneId);
  const [device, setDevice] = createSignal<HeartRateDevice | null>(null);
  const [characteristic, setCharacteristic] = createSignal<HeartRateCharacteristic | null>(null);
  const [isMobile, setIsMobile] = createSignal(false);
  const [exerciseLog, setExerciseLog] = createSignal<ExerciseLogEntry[]>(loadExerciseLog());
  const [selectedLogId, setSelectedLogId] = createSignal<string | null>(null);
  const [detailView, setDetailView] = createSignal<DetailView>("live");
  const [logTypeFilter, setLogTypeFilter] = createSignal<string | null>(null);
  const [typePickerEntryId, setTypePickerEntryId] = createSignal<string | null>(null);
  const [typePickerDraft, setTypePickerDraft] = createSignal("");
  const [editTypeDraft, setEditTypeDraft] = createSignal("");
  const [stopHoldProgress, setStopHoldProgress] = createSignal(0);
  const [deleteHoldProgress, setDeleteHoldProgress] = createSignal(0);
  const [pendingRange, setPendingRange] = createSignal<{ startMs: number; endMs: number } | null>(null);
  const [rangeLabel, setRangeLabel] = createSignal("");
  const [rangeMessage, setRangeMessage] = createSignal("");
  const [selectedRangeId, setSelectedRangeId] = createSignal<string | null>(null);

  let notificationCharacteristic: HeartRateCharacteristic | null = null;
  let importInput!: HTMLInputElement;
  let stopHoldTimer: number | undefined;
  let stopHoldFrame: number | undefined;
  let stopHoldStartedAt = 0;
  let deleteHoldTimer: number | undefined;
  let deleteHoldFrame: number | undefined;
  let deleteHoldStartedAt = 0;
  let simulateInterval: number | undefined;
  let simulateBpm = 100;
  let simulateTarget = 100;
  let userInitiatedDisconnect = false;
  let reconnectAttempt = 0;
  let reconnectTimer: number | undefined;

  const [simulatedConnected, setSimulatedConnected] = createSignal(false);
  const [monitorConnected, setMonitorConnected] = createSignal(false);
  const [reconnecting, setReconnecting] = createSignal(false);
  const connected = createMemo(() => simulatedConnected() || monitorConnected());
  const currentElapsedMs = createMemo(() => {
    if (exerciseState() !== "running" || exerciseStartedAt() === null) {
      return exerciseElapsedMs();
    }

    return exerciseElapsedMs() + now() - exerciseStartedAt()!;
  });
  const liveElapsedMs = createMemo(() => {
    if (exerciseState() === "running") {
      return currentElapsedMs();
    }

    if (exerciseState() === "paused") {
      return exerciseElapsedMs();
    }

    const startedAt = idleStartedAt();
    return startedAt === null ? 0 : now() - startedAt;
  });
  const stats = createMemo<HeartRateStats>(() => getHeartRateStats(readings(), zones(), liveElapsedMs()));
  const latestZone = createMemo(() => {
    const rate = latestRate();
    return rate === null ? null : getZoneForRate(zones(), rate);
  });
  const visibleExerciseLog = createMemo(() => exerciseLog().filter((entry) => !entry.hiddenAt));
  const exerciseTypes = createMemo(() => {
    const types = new Set<string>();
    visibleExerciseLog().forEach((entry) => {
      if (entry.exerciseType) {
        types.add(entry.exerciseType);
      }
    });
    return [...types].sort((first, second) => first.localeCompare(second));
  });
  const filteredExerciseLog = createMemo(() => {
    const filter = logTypeFilter();
    const entries = visibleExerciseLog();
    if (filter === null) {
      return entries;
    }
    if (filter === "__untyped__") {
      return entries.filter((entry) => !entry.exerciseType);
    }
    return entries.filter((entry) => entry.exerciseType === filter);
  });
  const selectedLog = createMemo(() => {
    const id = selectedLogId();
    const entries = visibleExerciseLog();
    return entries.find((entry) => entry.id === id) || entries[0] || null;
  });
  const selectedLogReadings = createMemo(() => selectedLog()?.readings || []);
  const selectedLogRanges = createMemo(() => selectedLog()?.ranges || []);
  const selectedRange = createMemo(() => selectedLogRanges().find((range) => range.id === selectedRangeId()) || null);
  const selectedRangeSummary = createMemo(() => {
    const range = selectedRange();
    if (!range) return null;
    const points = selectedLogReadings().filter((point) => point.time >= range.startMs && point.time <= range.endMs);
    if (!points.length) return null;
    const values = points.map((point) => point.bpm);
    return { start: values[0]!, end: values[values.length - 1]!, delta: values[values.length - 1]! - values[0]!, min: Math.min(...values), max: Math.max(...values) };
  });
  const selectedLogZones = createMemo(() => selectedLog()?.zones || zones());
  const selectedLogTargetZoneId = createMemo(() => selectedLog()?.targetZoneId || targetZoneId());
  const selectedLogStats = createMemo<HeartRateStats>(() => getHeartRateStats(selectedLogReadings(), selectedLogZones(), selectedLog()?.durationMs || 0));
  const displayReadings = createMemo(() => (detailView() === "log" ? selectedLogReadings() : readings()));
  const displayZones = createMemo(() => (detailView() === "log" ? selectedLogZones() : zones()));
  const displayTargetZoneId = createMemo(() => (detailView() === "log" ? selectedLogTargetZoneId() : targetZoneId()));
  const displayStats = createMemo(() => (detailView() === "log" ? selectedLogStats() : stats()));
  const displayDurationMs = createMemo(() => (detailView() === "log" ? selectedLog()?.durationMs || 0 : liveElapsedMs()));
  const displayChartDurationMs = createMemo(() => (detailView() === "log" ? selectedLog()?.durationMs || 0 : liveElapsedMs()));
  const selectedLogHrr = createMemo(() => {
    const entry = selectedLog();
    return entry && matchesHrrType(entry.exerciseType) ? calculateWorkoutHrr(entry) : null;
  });
  const showTimeAxis = () => true;
  const viewTabClass = (view: DetailView) =>
    `min-h-9 rounded-md px-3 text-[0.9rem] font-extrabold ${detailView() === view ? "bg-white text-[#172019] shadow-sm" : "text-[#617066]"}`;

  function beginRange(startMs: number, endMs: number): void {
    const overlaps = selectedLogRanges().some((range) => startMs < range.endMs && endMs > range.startMs);
    if (overlaps) {
      setPendingRange(null);
      setRangeMessage("This range overlaps an existing one.");
      return;
    }
    setPendingRange({ startMs, endMs });
    setRangeLabel("");
    setRangeMessage("");
  }

  function savePendingRange(): void {
    const entry = selectedLog();
    const pending = pendingRange();
    const label = rangeLabel().trim();
    if (!entry || !pending || !label) return;
    const nextRange: ChartRange = { id: `range-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, ...pending };
    setExerciseLog((entries) => entries.map((item) => item.id === entry.id ? { ...item, ranges: [...item.ranges, nextRange].sort((a, b) => a.startMs - b.startMs) } : item));
    setPendingRange(null);
    setRangeLabel("");
    setSelectedRangeId(nextRange.id);
  }

  function deleteRange(id: string): void {
    const entry = selectedLog();
    if (!entry) return;
    setExerciseLog((entries) => entries.map((item) => item.id === entry.id ? { ...item, ranges: item.ranges.filter((range) => range.id !== id) } : item));
    setSelectedRangeId(null);
  }

  createEffect(() => {
    saveZoneState(zones(), targetZoneId());
  });

  createEffect(() => {
    saveExerciseLog(exerciseLog());
  });

  createEffect(() => {
    const entries = visibleExerciseLog();
    if (!selectedLogId() && entries.length) {
      setSelectedLogId(entries[0]!.id);
    } else if (selectedLogId() && !entries.some((entry) => entry.id === selectedLogId())) {
      setSelectedLogId(entries[0]?.id || null);
    }
  });

  createEffect(() => {
    logTypeFilter();
    const filtered = filteredExerciseLog();
    const selectedId = selectedLogId();
    if (selectedId && filtered.length && !filtered.some((entry) => entry.id === selectedId)) {
      setSelectedLogId(filtered[0]!.id);
    }
  });

  createEffect(() => {
    setEditTypeDraft(selectedLog()?.exerciseType || "");
  });

  onMount(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));

    if (import.meta.env.DEV) {
      (window as Window & {
        __HRWEB_TEST__?: {
          connectSimulated: () => void;
          disconnectSimulated: () => void;
        };
      }).__HRWEB_TEST__ = {
        connectSimulated: connectSimulatedMonitor,
        disconnectSimulated: disconnectMonitor,
      };

      const handleDevHotkey = (event: KeyboardEvent) => {
        if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "h") {
          return;
        }

        event.preventDefault();
        if (simulatedConnected()) {
          disconnectMonitor();
        } else if (!connected()) {
          connectSimulatedMonitor();
        }
      };

      window.addEventListener("keydown", handleDevHotkey);
      onCleanup(() => {
        window.removeEventListener("keydown", handleDevHotkey);
        delete (window as Window & { __HRWEB_TEST__?: unknown }).__HRWEB_TEST__;
      });
    }
  });

  createEffect(() => {
    if (detailView() !== "live") return;

    const shouldTick = exerciseState() === "running" || (exerciseState() === "idle" && connected() && idleStartedAt() !== null);
    if (!shouldTick) return;

    const timer = window.setInterval(() => setNow(Date.now()), 250);
    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => {
    userInitiatedDisconnect = true;
    cancelReconnect();
    if (notificationCharacteristic) {
      notificationCharacteristic.removeEventListener("characteristicvaluechanged", handleHeartRateNotification);
    }
    stopSimulatedMonitor();
    cancelStopHold();
    cancelDeleteHold();
  });

  const setStatus = (label: string, mode: StatusMode = "muted"): void => {
    setConnectionStatus(label);
    setStatusMode(mode);
  };

  const updateZoneTrend = (bpm: number): void => {
    if (exerciseState() !== "running") return;

    const targetZone = zones().find((zone) => zone.id === targetZoneId()) || zones()[0];
    if (!targetZone) return;

    if (bpm < targetZone.min) {
      setTrend(`${targetZone.min - bpm} bpm below ${targetZone.name}`);
    } else if (bpm > targetZone.max) {
      setTrend(`${bpm - targetZone.max} bpm above ${targetZone.name}`);
    } else {
      setTrend(`In ${targetZone.name}`);
    }
  };

  function addReading(bpm: number): void {
    const rounded = Math.round(bpm);
    setLatestRate(rounded);

    if (exerciseState() !== "running") {
      if (exerciseState() === "idle") {
        const receivedAt = Date.now();
        const startedAt = idleStartedAt() ?? receivedAt;
        if (idleStartedAt() === null) {
          setIdleStartedAt(startedAt);
          setNow(receivedAt);
        }
        setReadings((items) => [...items, { bpm: rounded, time: receivedAt - startedAt }]);
        setLastRate(rounded);
      }

      if (exerciseState() === "paused") {
        setTrend("Paused");
      } else if (exerciseState() === "stopped") {
        setTrend("Stopped");
      } else {
        setTrend("Idle");
      }
      return;
    }

    setReadings((items) => [...items, { bpm: rounded, time: currentElapsedMs() }]);

    if (lastRate() === null) {
      setTrend("Recording");
    } else {
      const delta = rounded - lastRate()!;
      const direction = delta > 0 ? "up" : "down";
      setTrend(delta === 0 ? "Recording" : `${Math.abs(delta)} bpm ${direction}`);
    }

    updateZoneTrend(rounded);
    setLastRate(rounded);
  }

  function handleHeartRateNotification(event: Event): void {
    const nextValue = (event.target as HeartRateCharacteristic | null)?.value;
    if (nextValue) {
      addReading(parseHeartRateMeasurement(nextValue));
    }
  }

  function pickSimulatedTargetBpm(zoneList: Zone[]): number {
    const zone = zoneList[Math.floor(Math.random() * zoneList.length)]!;
    return zone.min + Math.random() * (zone.max - zone.min);
  }

  function connectSimulatedMonitor(): void {
    if (!import.meta.env.DEV || connected()) {
      return;
    }

    const zoneList = zones();
    simulateBpm = pickSimulatedTargetBpm(zoneList);
    simulateTarget = simulateBpm;

    setSimulatedConnected(true);
    setStatus("Live", "live");
    setMessage("Simulated monitor (Ctrl+Shift+H).");
    if (exerciseState() === "idle") {
      const startedAt = Date.now();
      setIdleStartedAt(startedAt);
      setNow(startedAt);
    }

    addReading(simulateBpm);

    simulateInterval = window.setInterval(() => {
      const currentZones = zones();
      if (!currentZones.length) {
        return;
      }

      if (Math.random() < 0.05) {
        simulateTarget = pickSimulatedTargetBpm(currentZones);
      }

      simulateBpm += (simulateTarget - simulateBpm) * 0.12 + (Math.random() - 0.5) * 5;
      const minBpm = currentZones[0]!.min;
      const maxBpm = currentZones[currentZones.length - 1]!.max;
      simulateBpm = Math.max(minBpm, Math.min(maxBpm, simulateBpm));
      addReading(simulateBpm);
    }, 1000);
  }

  function stopSimulatedMonitor(): void {
    if (simulateInterval !== undefined) {
      window.clearInterval(simulateInterval);
      simulateInterval = undefined;
    }

    if (!simulatedConnected()) {
      return;
    }

    setSimulatedConnected(false);
    setStatus("Disconnected", "warn");
    setMessage("Simulated monitor disconnected.");
    setIdleStartedAt(null);
    setReadings([]);
  }

  function cancelReconnect(): void {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function restoreConnectionStatus(): void {
    const state = exerciseState();
    if (state === "running") {
      setStatus("Recording", "live");
      setMessage("");
      setTrend("Recording");
    } else if (state === "paused") {
      setStatus("Paused", "warn");
      setMessage("");
    } else {
      setStatus("Live", "live");
      setMessage("Connected.");
      if (idleStartedAt() === null) {
        const startedAt = Date.now();
        setIdleStartedAt(startedAt);
        setNow(startedAt);
      }
    }
  }

  async function attachToDevice(nextDevice: HeartRateDevice): Promise<void> {
    if (notificationCharacteristic) {
      notificationCharacteristic.removeEventListener("characteristicvaluechanged", handleHeartRateNotification);
      try {
        await notificationCharacteristic.stopNotifications();
      } catch {
        // Notification shutdown can race with a device-level disconnect.
      }
    }

    const server = await nextDevice.gatt?.connect();
    if (!server) {
      throw new Error("Bluetooth device did not expose a GATT server.");
    }

    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const nextCharacteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);

    await nextCharacteristic.startNotifications();
    nextCharacteristic.addEventListener("characteristicvaluechanged", handleHeartRateNotification);

    notificationCharacteristic = nextCharacteristic;
    setDevice(nextDevice);
    setCharacteristic(nextCharacteristic);
    setMonitorConnected(true);
  }

  function scheduleReconnect(): void {
    if (userInitiatedDisconnect || !device()) {
      return;
    }

    const delay = Math.min(
      RECONNECT_INITIAL_DELAY_MS * 2 ** Math.max(0, reconnectAttempt - 1),
      RECONNECT_MAX_DELAY_MS,
    );

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void attemptReconnect();
    }, delay);
  }

  async function attemptReconnect(): Promise<void> {
    const currentDevice = device();
    if (!currentDevice || userInitiatedDisconnect) {
      return;
    }

    reconnectAttempt += 1;
    setStatus("Reconnecting", "warn");
    setMessage(`Connection lost. Retrying (${reconnectAttempt})...`);

    try {
      await attachToDevice(currentDevice);
      reconnectAttempt = 0;
      setReconnecting(false);
      restoreConnectionStatus();
    } catch {
      scheduleReconnect();
    }
  }

  function finalizeDisconnect(): void {
    cancelReconnect();
    setReconnecting(false);
    userInitiatedDisconnect = false;
    reconnectAttempt = 0;
    setMonitorConnected(false);
    setStatus("Disconnected", "warn");
    setMessage("Disconnected.");
    setDevice(null);
    setCharacteristic(null);
    notificationCharacteristic = null;
    setIdleStartedAt(null);
    setReadings([]);
  }

  function cancelReconnectMonitor(): void {
    userInitiatedDisconnect = true;
    finalizeDisconnect();
  }

  async function connectMonitor() {
    if (!("bluetooth" in navigator)) {
      setStatus("Unsupported", "warn");
      setMessage("Web Bluetooth unavailable.");
      return;
    }

    try {
      userInitiatedDisconnect = false;
      cancelReconnect();
      reconnectAttempt = 0;
      setReconnecting(false);
      setMonitorConnected(false);

      setStatus("Pairing", "warn");
      setMessage("Pairing...");

      const bluetoothNavigator = navigator as BluetoothNavigator;
      const nextDevice = await bluetoothNavigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
        optionalServices: [HEART_RATE_SERVICE],
      });

      nextDevice.addEventListener("gattserverdisconnected", handleDisconnect);

      await attachToDevice(nextDevice);
      restoreConnectionStatus();
    } catch (error) {
      const bluetoothError = error as Error;
      setStatus("Idle");
      setMessage(bluetoothError.name === "NotFoundError" ? "" : `Bluetooth error: ${bluetoothError.message}`);
    }
  }

  async function disconnectMonitor() {
    if (exerciseState() === "running") {
      pauseExercise();
    }

    if (simulatedConnected()) {
      stopSimulatedMonitor();
      return;
    }

    userInitiatedDisconnect = true;
    cancelReconnect();
    setReconnecting(false);

    if (notificationCharacteristic) {
      notificationCharacteristic.removeEventListener("characteristicvaluechanged", handleHeartRateNotification);
      try {
        await notificationCharacteristic.stopNotifications();
      } catch {
        // Notification shutdown can race with a device-level disconnect.
      }
    }

    if (device()?.gatt?.connected) {
      device()?.gatt?.disconnect();
    } else {
      finalizeDisconnect();
    }
  }

  function handleDisconnect(): void {
    setMonitorConnected(false);
    setCharacteristic(null);
    notificationCharacteristic = null;

    if (userInitiatedDisconnect) {
      finalizeDisconnect();
      return;
    }

    if (exerciseState() === "running") {
      pauseExercise();
    }

    setReconnecting(true);
    setStatus("Reconnecting", "warn");
    setMessage("Connection lost. Retrying...");
    scheduleReconnect();
  }

  function startExercise() {
    if (!connected()) {
      setMessage("Not connected.");
      return;
    }

    const startedAt = Date.now();
    setReadings([]);
    setLastRate(null);
    setIdleStartedAt(null);
    setExerciseElapsedMs(0);
    setExerciseStartedAt(startedAt);
    setExerciseSessionStartedAt(startedAt);
    setNow(startedAt);
    setExerciseState("running");
    setStatus("Recording", "live");
    setMessage("");
    setTrend("Recording");
    setDetailView("live");
  }

  function pauseExercise() {
    if (exerciseState() === "running") {
      setExerciseElapsedMs(currentElapsedMs());
      setExerciseStartedAt(null);
      setExerciseState("paused");
      setStatus("Paused", "warn");
      setMessage("");
      setTrend("Paused");
    } else if (exerciseState() === "paused") {
      setExerciseStartedAt(Date.now());
      setNow(Date.now());
      setExerciseState("running");
      setStatus("Recording", "live");
      setMessage("");
      setTrend("Recording");
    }
  }

  function setExerciseType(entryId: string, value: string): void {
    const exerciseType = normalizeExerciseType(value);
    setExerciseLog((entries) =>
      entries.map((entry) => (entry.id === entryId ? { ...entry, exerciseType } : entry)),
    );
  }

  function confirmExerciseType(entryId: string, value: string): void {
    setExerciseType(entryId, value);
    setEditTypeDraft(normalizeExerciseType(value) || "");
    if (typePickerEntryId() === entryId) {
      setTypePickerEntryId(null);
      setTypePickerDraft("");
    }
  }

  function skipExerciseTypePicker(): void {
    setTypePickerEntryId(null);
    setTypePickerDraft("");
  }

  function stopExercise() {
    if (exerciseState() !== "running" && exerciseState() !== "paused") return;

    const stoppedAt = Date.now();
    const durationMs = currentElapsedMs();
    const currentReadings = readings();
    const startedAt = exerciseSessionStartedAt() || stoppedAt - durationMs;
    const entry: ExerciseLogEntry = {
      id: `${stoppedAt}-${Math.random().toString(36).slice(2, 9)}`,
      startedAt,
      stoppedAt,
      durationMs,
      readings: currentReadings,
      targetZoneId: targetZoneId(),
      zones: zones().map((zone) => ({ ...zone })),
      ranges: [],
    };

    setExerciseLog((entries) => [entry, ...entries]);
    setSelectedLogId(entry.id);
    setDetailView("log");
    setTypePickerEntryId(entry.id);
    setTypePickerDraft("");
    setReadings([]);
    setIdleStartedAt(null);
    setExerciseElapsedMs(0);
    setExerciseStartedAt(null);
    setExerciseSessionStartedAt(null);
    setExerciseState("idle");
    setStatus(connected() ? "Live" : "Disconnected", connected() ? "live" : "warn");
    setMessage("");
    setTrend(currentReadings.length ? "Done" : "Idle");
    if (connected()) {
      const previewStartedAt = Date.now();
      setIdleStartedAt(previewStartedAt);
      setNow(previewStartedAt);
    }
  }

  function cancelStopHold(): void {
    if (stopHoldTimer !== undefined) {
      window.clearTimeout(stopHoldTimer);
      stopHoldTimer = undefined;
    }

    if (stopHoldFrame !== undefined) {
      window.cancelAnimationFrame(stopHoldFrame);
      stopHoldFrame = undefined;
    }

    stopHoldStartedAt = 0;
    setStopHoldProgress(0);
  }

  function startStopHold(): void {
    if (exerciseState() !== "running" && exerciseState() !== "paused") return;
    cancelStopHold();

    stopHoldStartedAt = Date.now();
    const updateProgress = () => {
      const progress = Math.min(1, (Date.now() - stopHoldStartedAt) / STOP_HOLD_MS);
      setStopHoldProgress(progress);
      if (progress < 1) {
        stopHoldFrame = window.requestAnimationFrame(updateProgress);
      }
    };

    updateProgress();
    stopHoldTimer = window.setTimeout(() => {
      setStopHoldProgress(1);
      stopExercise();
      window.setTimeout(cancelStopHold, 120);
    }, STOP_HOLD_MS);
  }

  function handleExerciseButton() {
    if (exerciseState() === "running" || exerciseState() === "paused") {
      pauseExercise();
      return;
    }

    startExercise();
  }

  function exerciseButtonLabel() {
    if (exerciseState() === "running") return "Pause";
    if (exerciseState() === "paused") return "Resume";
    return "Start";
  }

  function updateZones(nextZones: Zone[]): void {
    setZones(nextZones);
    if (latestRate() !== null) {
      updateZoneTrend(latestRate()!);
    }
  }

  function updateTargetZone(zoneId: number): void {
    setTargetZoneId(zoneId);
    if (latestRate() !== null) {
      updateZoneTrend(latestRate()!);
    }
  }

  function exportExerciseLog(): void {
    const payload = JSON.stringify({ version: 2, entries: visibleExerciseLog() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `exercise-log-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importExerciseLog(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as StoredExerciseLog | ExerciseLogEntry[];
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries)) {
        throw new Error("File does not contain an exercise log.");
      }

      const nextEntries = entries
        .map(sanitizeLogEntry)
        .filter((entry): entry is ExerciseLogEntry => Boolean(entry));

      if (!nextEntries.length) {
        throw new Error("No valid exercise entries were found.");
      }

      const sorted = [...nextEntries].sort((first, second) => second.stoppedAt - first.stoppedAt);
      setExerciseLog(sorted);
      setSelectedLogId(sorted[0]?.id || null);
      setLogTypeFilter(null);
      setTypePickerEntryId(null);
      setTypePickerDraft("");
      setDetailView("log");
      setMessage(`Replaced log with ${nextEntries.length} exercise${nextEntries.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage((error as Error).message || "Could not import exercise log.");
    } finally {
      input.value = "";
    }
  }

  function deleteSelectedLog(): void {
    const entry = selectedLog();
    if (!entry) return;

    setExerciseLog((entries) => {
      const nextEntries = entries.map((item) => (item.id === entry.id ? { ...item, hiddenAt: Date.now() } : item));
      const nextVisibleEntries = nextEntries.filter((item) => !item.hiddenAt);
      setSelectedLogId(nextVisibleEntries[0]?.id || null);
      return nextEntries;
    });
  }

  function cancelDeleteHold(): void {
    if (deleteHoldTimer !== undefined) {
      window.clearTimeout(deleteHoldTimer);
      deleteHoldTimer = undefined;
    }

    if (deleteHoldFrame !== undefined) {
      window.cancelAnimationFrame(deleteHoldFrame);
      deleteHoldFrame = undefined;
    }

    deleteHoldStartedAt = 0;
    setDeleteHoldProgress(0);
  }

  function startDeleteHold(): void {
    if (!selectedLog()) return;
    cancelDeleteHold();

    deleteHoldStartedAt = Date.now();
    const updateProgress = () => {
      const progress = Math.min(1, (Date.now() - deleteHoldStartedAt) / STOP_HOLD_MS);
      setDeleteHoldProgress(progress);
      if (progress < 1) {
        deleteHoldFrame = window.requestAnimationFrame(updateProgress);
      }
    };

    updateProgress();
    deleteHoldTimer = window.setTimeout(() => {
      setDeleteHoldProgress(1);
      deleteSelectedLog();
      window.setTimeout(cancelDeleteHold, 120);
    }, STOP_HOLD_MS);
  }

  return (
    <div class="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(217,24,75,0.13),transparent_30rem),linear-gradient(145deg,#f6f7f4_0%,#eef4f2_45%,#faf7f2_100%)] text-[#172019]">
    <main class={`mx-auto grid w-[min(1180px,calc(100vw-32px))] grid-cols-[minmax(300px,390px)_1fr] gap-[18px] py-8 max-[820px]:grid-cols-1 max-[820px]:py-[18px] ${isMobile() ? "!w-[calc(100vw-14px)] !gap-2 !py-2" : ""}`}>
      <section class={`${cardClass} flex min-h-[560px] flex-col p-6 max-[820px]:min-h-0 ${isMobile() ? "!min-h-0 !p-[10px_12px_8px]" : ""}`} aria-labelledby="app-title">
        <Show when={!isMobile()}>
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 id="app-title" class="m-0 max-w-[250px] text-[clamp(2rem,5vw,3.5rem)] leading-[0.98] tracking-normal">Heart Rate Monitor</h1>
            </div>
            <span data-testid="connection-status" class={`flex-none rounded-full border px-2.5 py-1.5 text-[0.78rem] font-bold ${statusMode() === "live" ? "border-[#087f5b]/25 bg-[#087f5b]/10 text-[#087f5b]" : statusMode() === "warn" ? "border-[#986b00]/30 bg-[#986b00]/10 text-[#986b00]" : "border-[#dbe2dc] bg-[#f9faf8] text-[#617066]"}`}>{connectionStatus()}</span>
          </div>
        </Show>

        <div class={`my-auto mb-8 max-[820px]:my-[34px] max-[820px]:mb-7 ${isMobile() ? "!m-0 !mb-2.5" : ""}`} aria-live="polite">
          <div>
            <span data-testid="latest-bpm" class={`text-[clamp(5.5rem,18vw,10.5rem)] font-extrabold leading-[0.9] tracking-normal tabular-nums ${isMobile() ? "!text-[clamp(8.8rem,38vw,12rem)] !leading-[0.82]" : ""}`} style={{ color: latestZone()?.color || "#172019" }}>{latestRate() ?? "--"}</span>
            <span class={`font-extrabold text-[#617066] ${isMobile() ? "text-[1.05rem]" : ""}`}>bpm</span>
          </div>
          <div data-testid="trend" class={`mt-3.5 min-h-[26px] font-semibold text-[#617066] ${isMobile() ? "!mt-0.5 min-h-[18px] text-[0.95rem]" : ""}`}>{trend()}</div>
        </div>

        <div class={`grid ${connected() ? "grid-cols-3" : "grid-cols-2"} gap-2.5 ${isMobile() ? "!gap-1.5" : ""}`} aria-label="Bluetooth and exercise controls">
          <Show when={!connected() && !reconnecting()}>
            <button data-testid="connect-button" class={`${primaryButtonClass} col-span-full ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`} type="button" onClick={connectMonitor}>Connect monitor</button>
          </Show>
          <Show when={reconnecting()}>
            <button data-testid="cancel-reconnect-button" class={`${secondaryButtonClass} col-span-full ${isMobile() ? "!min-h-10 !px-2.5 text-[0.9rem]" : ""}`} type="button" onClick={cancelReconnectMonitor}>Cancel reconnect</button>
          </Show>
          <Show when={connected()}>
            <button data-testid="disconnect-button" class={`${secondaryButtonClass} ${isMobile() ? "!min-h-10 !px-2.5 text-[0.9rem]" : ""}`} type="button" onClick={disconnectMonitor}>Disconnect</button>
          </Show>
          <button
            data-testid="exercise-button"
            class={`${exerciseState() === "running" ? `${secondaryButtonClass} border-[#986b00]/35 bg-[#986b00]/10 text-[#986b00]` : primaryButtonClass} ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`}
            type="button"
            disabled={!connected()}
            onClick={handleExerciseButton}
          >
            {exerciseButtonLabel()}
          </button>
          <button
            data-testid="stop-button"
            class={`${secondaryButtonClass} relative overflow-hidden ${stopHoldProgress() > 0 ? "border-[#d9184b]/45 text-[#d9184b]" : ""} ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`}
            type="button"
            disabled={exerciseState() !== "running" && exerciseState() !== "paused"}
            onPointerDown={startStopHold}
            onPointerUp={cancelStopHold}
            onPointerLeave={cancelStopHold}
            onPointerCancel={cancelStopHold}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && stopHoldProgress() === 0) {
                event.preventDefault();
                startStopHold();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                cancelStopHold();
              }
            }}
          >
            <span class="absolute inset-y-0 left-0 bg-[#d9184b]/12" style={{ width: `${stopHoldProgress() * 100}%` }} />
            <span class="relative">{stopHoldProgress() > 0 ? "Hold..." : "Stop"}</span>
          </button>
        </div>

      </section>

      <section class={`${cardClass} min-w-0 p-[22px] ${isMobile() ? "!p-[8px_8px_10px]" : ""}`} aria-labelledby="chart-title">
        <div class={`flex items-start justify-between gap-4 ${isMobile() ? "block" : ""}`}>
          <Show when={!isMobile()}>
            <div>
              <div id="chart-title" class="grid grid-cols-3 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] p-1" aria-label="Exercise view">
                <button data-testid="view-tab-live" class={viewTabClass("live")} type="button" onClick={() => setDetailView("live")}>Live</button>
                <button data-testid="view-tab-log" class={viewTabClass("log")} type="button" onClick={() => setDetailView("log")}>Log</button>
                <button data-testid="view-tab-metrics" class={viewTabClass("metrics")} type="button" onClick={() => setDetailView("metrics")}>Metrics</button>
              </div>
            </div>
          </Show>
          <div class={`grid grid-cols-4 gap-2 ${isMobile() ? "!w-full !grid-cols-4 !gap-1" : ""}`}>
            <div data-testid="stat-time" class={`${statTileClass} ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "w-20 [&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_span]:whitespace-nowrap"}`}>
              <span class="block">{formatDuration(displayDurationMs())}</span>
              <small class="block font-bold text-[#617066]">Time</small>
            </div>
            <div data-testid="stat-min" class={`${statTileClass} ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "w-20 [&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_span]:whitespace-nowrap"}`}>
              <span class="block">{displayStats().min}</span>
              <small class="block font-bold text-[#617066]">Min HR</small>
            </div>
            <div data-testid="stat-avg" class={`${statTileClass} ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "w-20 [&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_span]:whitespace-nowrap"}`}>
              <span class="block">{displayStats().avg}</span>
              <small class="block font-bold text-[#617066]">Avg HR</small>
            </div>
            <div data-testid="stat-max" class={`${statTileClass} ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "w-20 [&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_span]:whitespace-nowrap"}`}>
              <span class="block">{displayStats().max}</span>
              <small class="block font-bold text-[#617066]">Max HR</small>
            </div>
          </div>
        </div>

        <Show when={isMobile()}>
          <div class="mt-2 grid grid-cols-3 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] p-1" aria-label="Exercise view">
            <button data-testid="view-tab-live" class={viewTabClass("live")} type="button" onClick={() => setDetailView("live")}>Live</button>
            <button data-testid="view-tab-log" class={viewTabClass("log")} type="button" onClick={() => setDetailView("log")}>Log</button>
            <button data-testid="view-tab-metrics" class={viewTabClass("metrics")} type="button" onClick={() => setDetailView("metrics")}>Metrics</button>
          </div>
        </Show>

        <Show when={detailView() === "metrics"}>
          <div class={metricsContentClass(isMobile())}>
            <MetricsView entries={visibleExerciseLog} mobile={isMobile} />
          </div>
        </Show>

        <Show
          when={detailView() === "log"}
          fallback={
            <Show when={detailView() === "live"}>
              <div class={detailContentClass(isMobile())}>
                <HeartChart readings={displayReadings} zones={displayZones} targetZoneId={displayTargetZoneId} mobile={isMobile} showTimeAxis={showTimeAxis} durationMs={displayChartDurationMs} />
                <ZoneTimeStats stats={displayStats} mobile={isMobile} />
                <ZoneEditor
                  zones={zones}
                  targetZoneId={targetZoneId}
                  mobile={isMobile}
                  onZonesChange={updateZones}
                  onTargetChange={updateTargetZone}
                />
              </div>
            </Show>
          }
        >
          <div class={`${detailContentClass(isMobile())} grid grid-cols-[minmax(180px,260px)_1fr] gap-3 max-[940px]:grid-cols-1 ${isMobile() ? "!gap-2" : ""}`}>
            <div class="flex min-h-[220px] flex-col rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] p-2">
              <Show when={visibleExerciseLog().length}>
                <label class="mb-2 grid gap-1">
                  <span class="text-[0.72rem] font-bold uppercase tracking-[0.04em] text-[#617066]">Filter by type</span>
                  <select
                    data-testid="log-type-filter"
                    class="min-h-9 rounded-lg border border-[#dbe2dc] bg-white px-2.5 text-[0.85rem] font-bold text-[#172019]"
                    value={logTypeFilter() ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setLogTypeFilter(value === "" ? null : value);
                    }}
                  >
                    <option value="">All types</option>
                    <option value="__untyped__">Untyped</option>
                    <For each={exerciseTypes()}>{(type) => <option value={type}>{type}</option>}</For>
                  </select>
                </label>
              </Show>
              <Show when={visibleExerciseLog().length} fallback={<p data-testid="log-empty" class="m-0 p-3 text-sm font-semibold text-[#617066]">No exercises yet.</p>}>
                <div class="grid gap-1.5" data-testid="log-entries">
                  <For each={filteredExerciseLog()}>
                    {(entry) => (
                      <button
                        data-testid={`log-entry-${entry.id}`}
                        class={`rounded-md border px-3 py-2 text-left ${entry.id === selectedLog()?.id ? "border-[#d9184b]/35 bg-white text-[#172019]" : "border-transparent text-[#617066] hover:bg-white"}`}
                        type="button"
                        onClick={() => setSelectedLogId(entry.id)}
                      >
                        <span class="block text-[0.9rem] font-extrabold">{formatDateTime(entry.startedAt)}</span>
                        <span class="block text-[0.78rem] font-bold">
                          {formatDuration(entry.durationMs)} · {entry.readings.length} readings
                          {entry.exerciseType ? ` · ${entry.exerciseType}` : ""}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={visibleExerciseLog().length && !filteredExerciseLog().length}>
                  <p data-testid="log-filter-empty" class="m-0 px-2 py-3 text-sm font-semibold text-[#617066]">No exercises match this type filter.</p>
                </Show>
              </Show>
              <div class="mt-auto grid grid-cols-3 gap-2 border-t border-[#dbe2dc] pt-2">
                <button data-testid="export-log-button" class={`${secondaryButtonClass} !min-h-9 !px-2 !text-[0.82rem]`} type="button" disabled={!visibleExerciseLog().length} onClick={exportExerciseLog}>Export</button>
                <button data-testid="import-log-button" class={`${secondaryButtonClass} !min-h-9 !px-2 !text-[0.82rem]`} type="button" onClick={() => importInput.click()}>Import</button>
                <button
                  data-testid="delete-log-button"
                  class={`${secondaryButtonClass} relative !min-h-9 overflow-hidden !px-2 !text-[0.82rem] ${deleteHoldProgress() > 0 ? "border-[#d9184b]/45 text-[#d9184b]" : ""}`}
                  type="button"
                  disabled={!selectedLog()}
                  onPointerDown={startDeleteHold}
                  onPointerUp={cancelDeleteHold}
                  onPointerLeave={cancelDeleteHold}
                  onPointerCancel={cancelDeleteHold}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && deleteHoldProgress() === 0) {
                      event.preventDefault();
                      startDeleteHold();
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      cancelDeleteHold();
                    }
                  }}
                >
                  <span class="absolute inset-y-0 left-0 bg-[#d9184b]/12" style={{ width: `${deleteHoldProgress() * 100}%` }} />
                  <span class="relative">{deleteHoldProgress() > 0 ? "Hold" : "Delete"}</span>
                </button>
                <input ref={importInput} data-testid="import-log-input" class="hidden" type="file" accept="application/json,.json" onChange={importExerciseLog} />
              </div>
            </div>
            <div class="min-w-0">
              <Show when={selectedLog()}>
                {(entry) => (
                  <Show
                    when={typePickerEntryId() === entry().id}
                    fallback={
                      <ExerciseTypeInput
                        types={exerciseTypes()}
                        value={editTypeDraft()}
                        listId={`exercise-type-${entry().id}`}
                        compact
                        onInput={setEditTypeDraft}
                        onConfirm={(value) => confirmExerciseType(entry().id, value)}
                      />
                    }
                  >
                    <ExerciseTypeInput
                      types={exerciseTypes()}
                      value={typePickerDraft()}
                      listId={`exercise-type-picker-${entry().id}`}
                      autofocus
                      confirmLabel="Save"
                      onInput={setTypePickerDraft}
                      onConfirm={(value) => confirmExerciseType(entry().id, value)}
                      onSkip={skipExerciseTypePicker}
                    />
                  </Show>
                )}
              </Show>
              <Show when={selectedLogHrr() !== null}>
                <div data-testid="log-hrr-stat" class={`mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2 ${isMobile() ? "!mb-1.5" : ""}`}>
                  <div class={`${statTileClass} text-left ${isMobile() ? "!min-w-0 !p-[5px_8px]" : ""}`}>
                    <span class="block text-[1.05rem] font-extrabold tabular-nums text-[#f77f00]">−{selectedLogHrr()} bpm</span>
                    <small class="block font-bold text-[#617066]">HRR 1 min</small>
                  </div>
                </div>
              </Show>
              <div data-testid="range-toolbar" class="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-[#617066]"><span>Drag across the chart to label a range</span><span data-testid="range-count">{selectedLogRanges().length} range{selectedLogRanges().length === 1 ? "" : "s"}</span></div>
              <div class="relative">
                <HeartChart readings={displayReadings} zones={displayZones} targetZoneId={displayTargetZoneId} mobile={isMobile} showTimeAxis={showTimeAxis} durationMs={displayChartDurationMs} ranges={selectedLogRanges} selectable={() => Boolean(selectedLog())} onRangeSelected={beginRange} onRangeClick={(range) => setSelectedRangeId(range.id)} />
                <Show when={selectedRange()}>{(range) => <Show when={selectedRangeSummary()}>{(summary) =>
                  <div data-testid="range-details" class="absolute right-3 top-8 z-10 max-w-[260px] rounded-lg border border-[#dbe2dc] bg-white/95 p-3 shadow-lg backdrop-blur-sm">
                    <div class="flex items-start justify-between gap-4"><div><strong class="block">{range().label}</strong><small class="font-bold text-[#617066]">{formatDuration(range().startMs)}–{formatDuration(range().endMs)}</small></div><button class="text-lg leading-none text-[#617066]" type="button" aria-label="Close range details" onClick={() => setSelectedRangeId(null)}>×</button></div>
                    <div class="mt-2 flex items-end justify-between gap-4 text-sm"><span><b>{summary().start}→{summary().end}</b><small class="block text-[#617066]">bpm</small></span><span><b class={summary().delta > 0 ? "text-[#087f5b]" : summary().delta < 0 ? "text-[#d9184b]" : ""}>{summary().delta > 0 ? "+" : ""}{summary().delta}</b><small class="block text-[#617066]">change</small></span><button data-testid="range-delete" class="font-bold text-[#d9184b]" type="button" onClick={() => deleteRange(range().id)}>Delete</button></div>
                  </div>
                }</Show>}</Show>
              </div>
              <Show when={pendingRange()}>{(range) => <form data-testid="range-form" class="mt-2 flex gap-2 rounded-lg border border-[#d9184b]/25 bg-[#d9184b]/5 p-2" onSubmit={(event) => { event.preventDefault(); savePendingRange(); }}>
                <input data-testid="range-label" class="min-w-0 flex-1 rounded-md border border-[#dbe2dc] bg-white px-3" value={rangeLabel()} onInput={(event) => setRangeLabel(event.currentTarget.value)} placeholder={`${formatDuration(range().startMs)}–${formatDuration(range().endMs)} label`} autofocus />
                <button data-testid="range-save" class={`${primaryButtonClass} !min-h-9`} type="submit" disabled={!rangeLabel().trim()}>Save</button><button class={`${secondaryButtonClass} !min-h-9`} type="button" onClick={() => setPendingRange(null)}>Cancel</button>
              </form>}</Show>
              <Show when={rangeMessage()}><p data-testid="range-message" class="my-2 text-sm font-bold text-[#d9184b]">{rangeMessage()}</p></Show>
              <ZoneTimeStats stats={displayStats} mobile={isMobile} />
            </div>
          </div>
        </Show>
      </section>
    </main>
    </div>
  );
}
