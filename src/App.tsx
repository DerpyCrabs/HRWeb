import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor, JSX } from "solid-js";

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

type StatusMode = "muted" | "warn" | "live";
type ExerciseState = "idle" | "running" | "paused" | "stopped";

type StatValue = number | "--";

type HeartRateStats = {
  min: StatValue;
  avg: StatValue;
  max: StatValue;
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
const ZONES_STORAGE_KEY = "heartRateExercise.zones.v1";
const DEFAULT_ZONES: Zone[] = [
  { id: 1, name: "Zone 1", min: 90, max: 110, color: "#2a9d8f" },
  { id: 2, name: "Zone 2", min: 111, max: 130, color: "#70b62c" },
  { id: 3, name: "Zone 3", min: 131, max: 150, color: "#f0b429" },
  { id: 4, name: "Zone 4", min: 151, max: 170, color: "#f77f00" },
  { id: 5, name: "Zone 5", min: 171, max: 190, color: "#d9184b" },
];

const cardClass = "rounded-lg border border-[#dbe2dc]/90 bg-white/95 shadow-[0_18px_45px_rgba(24,31,27,0.11)]";
const primaryButtonClass = "min-h-[46px] cursor-pointer rounded-lg border border-transparent bg-[#d9184b] px-4 text-[1rem] font-extrabold text-white hover:bg-[#a80f37] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "min-h-[46px] cursor-pointer rounded-lg border border-[#dbe2dc] bg-white px-4 text-[1rem] font-extrabold text-[#172019] hover:not-disabled:border-[#aebcaf] disabled:cursor-not-allowed disabled:opacity-50";

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

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

type HeartChartProps = {
  readings: Accessor<Reading[]>;
  zones: Accessor<Zone[]>;
  targetZoneId: Accessor<number>;
  mobile: Accessor<boolean>;
};

function HeartChart(props: HeartChartProps): JSX.Element {
  let canvas!: HTMLCanvasElement;

  createEffect(() => {
    const readings = props.readings();
    const zones = props.zones();
    const targetZoneId = props.targetZoneId();
    drawChart(canvas, readings, zones, targetZoneId, props.mobile());
  });

  onMount(() => {
    const resize = () => drawChart(canvas, props.readings(), props.zones(), props.targetZoneId(), props.mobile());
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));
  });

  return (
    <div class={`mt-5 w-full aspect-[16/9] min-h-[360px] ${props.mobile() ? "!mt-2" : ""}`}>
      <canvas ref={canvas} class="block h-full w-full rounded-lg border border-[#dbe2dc] bg-[#fffdfa]" width="1200" height="520" aria-label="Heart rate line chart" />
    </div>
  );
}

function drawChart(
  canvas: HTMLCanvasElement | undefined,
  readings: Reading[],
  zones: Zone[],
  targetZoneId: number,
  mobile = false,
): void {
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx || !zones.length) return;

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const padding = mobile ? 0 : Math.max(34, Math.round(width * 0.04));
  const left = padding;
  const right = mobile ? 0 : padding * 0.5;
  const bottomPadding = mobile ? 0 : padding * 1.1;
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
    ctx.font = `${Math.max(12, Math.round(width / 95))}px system-ui, sans-serif`;
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
      ctx.fillText(String(boundary.label), left - 8, yForBpm(boundary.value));
    });

    ctx.textAlign = "start";
  }

  if (readings.length < 2) return;

  const firstTime = readings[0]!.time;
  const lastTime = readings[readings.length - 1]!.time;
  const timeSpan = Math.max(1, lastTime - firstTime);
  const xForPoint = (point: Reading) => left + ((point.time - firstTime) / timeSpan) * plotWidth;
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
  const [now, setNow] = createSignal(Date.now());
  const [zones, setZones] = createSignal<Zone[]>(initialZoneState.zones);
  const [targetZoneId, setTargetZoneId] = createSignal(initialZoneState.targetZoneId);
  const [device, setDevice] = createSignal<HeartRateDevice | null>(null);
  const [characteristic, setCharacteristic] = createSignal<HeartRateCharacteristic | null>(null);
  const [isMobile, setIsMobile] = createSignal(false);

  let notificationCharacteristic: HeartRateCharacteristic | null = null;

  const connected = createMemo(() => Boolean(device()?.gatt?.connected && characteristic()));
  const currentElapsedMs = createMemo(() => {
    if (exerciseState() !== "running" || exerciseStartedAt() === null) {
      return exerciseElapsedMs();
    }

    return exerciseElapsedMs() + now() - exerciseStartedAt()!;
  });
  const stats = createMemo<HeartRateStats>(() => {
    const values = readings().map((point) => point.bpm);
    if (!values.length) {
      return { min: "--", avg: "--", max: "--" };
    }

    return {
      min: Math.min(...values),
      avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      max: Math.max(...values),
    };
  });
  const latestZone = createMemo(() => {
    const rate = latestRate();
    return rate === null ? null : getZoneForRate(zones(), rate);
  });

  createEffect(() => {
    saveZoneState(zones(), targetZoneId());
  });

  onMount(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    onCleanup(() => query.removeEventListener("change", update));
  });

  createEffect(() => {
    if (exerciseState() !== "running") return;

    const timer = window.setInterval(() => setNow(Date.now()), 250);
    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => {
    if (notificationCharacteristic) {
      notificationCharacteristic.removeEventListener("characteristicvaluechanged", handleHeartRateNotification);
    }
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

  async function connectMonitor() {
    if (!("bluetooth" in navigator)) {
      setStatus("Unsupported", "warn");
      setMessage("Web Bluetooth unavailable.");
      return;
    }

    try {
      setStatus("Pairing", "warn");
      setMessage("Pairing...");

      const bluetoothNavigator = navigator as BluetoothNavigator;
      const nextDevice = await bluetoothNavigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
        optionalServices: [HEART_RATE_SERVICE],
      });

      nextDevice.addEventListener("gattserverdisconnected", handleDisconnect);

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
      setStatus("Live", "live");
      setMessage("Connected.");
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
      handleDisconnect();
    }
  }

  function handleDisconnect() {
    setStatus("Disconnected", "warn");
    setMessage("Disconnected.");
    setCharacteristic(null);
    notificationCharacteristic = null;
  }

  function startExercise() {
    if (!connected()) {
      setMessage("Not connected.");
      return;
    }

    setReadings([]);
    setLastRate(null);
    setExerciseElapsedMs(0);
    setExerciseStartedAt(Date.now());
    setNow(Date.now());
    setExerciseState("running");
    setStatus("Recording", "live");
    setMessage("");
    setTrend("Recording");
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

  function stopExercise() {
    if (exerciseState() !== "running" && exerciseState() !== "paused") return;

    setExerciseElapsedMs(currentElapsedMs());
    setExerciseStartedAt(null);
    setExerciseState("stopped");
    setStatus(connected() ? "Live" : "Stopped", connected() ? "live" : "warn");
    setMessage("");
    setTrend(readings().length ? "Done" : "Stopped");
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

  return (
    <div class="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(217,24,75,0.13),transparent_30rem),linear-gradient(145deg,#f6f7f4_0%,#eef4f2_45%,#faf7f2_100%)] text-[#172019]">
    <main class={`mx-auto grid w-[min(1180px,calc(100vw-32px))] grid-cols-[minmax(300px,390px)_1fr] gap-[18px] py-8 max-[820px]:grid-cols-1 max-[820px]:py-[18px] ${isMobile() ? "!w-[calc(100vw-14px)] !gap-2 !py-2" : ""}`}>
      <section class={`${cardClass} flex min-h-[560px] flex-col p-6 max-[820px]:min-h-0 ${isMobile() ? "!min-h-0 !p-[10px_12px_8px]" : ""}`} aria-labelledby="app-title">
        <Show when={!isMobile()}>
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 id="app-title" class="m-0 max-w-[250px] text-[clamp(2rem,5vw,3.5rem)] leading-[0.98] tracking-normal">Heart Rate Monitor</h1>
            </div>
            <span class={`flex-none rounded-full border px-2.5 py-1.5 text-[0.78rem] font-bold ${statusMode() === "live" ? "border-[#087f5b]/25 bg-[#087f5b]/10 text-[#087f5b]" : statusMode() === "warn" ? "border-[#986b00]/30 bg-[#986b00]/10 text-[#986b00]" : "border-[#dbe2dc] bg-[#f9faf8] text-[#617066]"}`}>{connectionStatus()}</span>
          </div>
        </Show>

        <div class={`my-auto mb-8 max-[820px]:my-[34px] max-[820px]:mb-7 ${isMobile() ? "!m-0 !mb-2.5" : ""}`} aria-live="polite">
          <div>
            <span class={`text-[clamp(5.5rem,18vw,10.5rem)] font-extrabold leading-[0.9] tracking-normal tabular-nums ${isMobile() ? "!text-[clamp(8.8rem,38vw,12rem)] !leading-[0.82]" : ""}`} style={{ color: latestZone()?.color || "#172019" }}>{latestRate() ?? "--"}</span>
            <span class={`font-extrabold text-[#617066] ${isMobile() ? "text-[1.05rem]" : ""}`}>bpm</span>
          </div>
          <div class={`mt-3.5 min-h-[26px] font-semibold text-[#617066] ${isMobile() ? "!mt-0.5 min-h-[18px] text-[0.95rem]" : ""}`}>{trend()}</div>
        </div>

        <div class={`grid grid-cols-3 gap-2.5 ${isMobile() ? "!gap-1.5" : ""}`} aria-label="Bluetooth and exercise controls">
          <Show when={!connected()}>
            <button class={`${primaryButtonClass} col-span-full ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`} type="button" onClick={connectMonitor}>Connect monitor</button>
          </Show>
          <button class={`${secondaryButtonClass} ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`} type="button" disabled={!connected()} onClick={disconnectMonitor}>Disconnect</button>
          <button
            class={`${exerciseState() === "running" ? `${secondaryButtonClass} border-[#986b00]/35 bg-[#986b00]/10 text-[#986b00]` : primaryButtonClass} ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`}
            type="button"
            disabled={!connected()}
            onClick={handleExerciseButton}
          >
            {exerciseButtonLabel()}
          </button>
          <button class={`${secondaryButtonClass} ${isMobile() ? "!min-h-10 !px-2.5 text-[0.95rem]" : ""}`} type="button" disabled={exerciseState() !== "running" && exerciseState() !== "paused"} onClick={stopExercise}>Stop</button>
        </div>

        <Show when={message()}>
          <p class={`mt-[18px] min-h-[22px] leading-[1.45] text-[#617066] ${isMobile() ? "!mt-1.5 min-h-0 text-[0.82rem]" : ""}`} aria-live="polite">{message()}</p>
        </Show>
      </section>

      <section class={`${cardClass} min-w-0 p-[22px] ${isMobile() ? "!p-[8px_8px_10px]" : ""}`} aria-labelledby="chart-title">
        <div class={`flex items-start justify-between gap-4 ${isMobile() ? "block" : ""}`}>
          <Show when={!isMobile()}>
            <div>
              <p class="m-0 mb-1.5 text-[0.77rem] font-bold uppercase tracking-normal text-[#617066]">Exercise trace</p>
              <h2 id="chart-title" class="m-0 text-xl tracking-normal">Full exercise graph</h2>
            </div>
          </Show>
          <div class={`grid grid-cols-4 gap-2 ${isMobile() ? "!w-full !grid-cols-4 !gap-1" : ""}`}>
            <div class={`min-w-16 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] px-2.5 py-2 text-right ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "[&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums"}`}>
              <span class="block">{formatDuration(currentElapsedMs())}</span>
              <small class="block font-bold text-[#617066]">Time</small>
            </div>
            <div class={`min-w-16 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] px-2.5 py-2 text-right ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "[&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums"}`}>
              <span class="block">{stats().min}</span>
              <small class="block font-bold text-[#617066]">Min HR</small>
            </div>
            <div class={`min-w-16 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] px-2.5 py-2 text-right ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "[&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums"}`}>
              <span class="block">{stats().avg}</span>
              <small class="block font-bold text-[#617066]">Avg HR</small>
            </div>
            <div class={`min-w-16 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] px-2.5 py-2 text-right ${isMobile() ? "!min-w-0 !p-[5px_6px] text-left [&_span]:text-[1.05rem] [&_span]:font-extrabold [&_span]:tabular-nums [&_small]:text-[0.68rem] [&_small]:whitespace-nowrap" : "[&_span]:text-[1.1rem] [&_span]:font-extrabold [&_span]:tabular-nums"}`}>
              <span class="block">{stats().max}</span>
              <small class="block font-bold text-[#617066]">Max HR</small>
            </div>
          </div>
        </div>

        <HeartChart readings={readings} zones={zones} targetZoneId={targetZoneId} mobile={isMobile} />
        <ZoneEditor
          zones={zones}
          targetZoneId={targetZoneId}
          mobile={isMobile}
          onZonesChange={updateZones}
          onTargetChange={updateTargetZone}
        />
      </section>
    </main>
    </div>
  );
}
