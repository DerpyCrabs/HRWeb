import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import {
  buildHrrTrend,
  buildTrimpBars,
  buildZone2Trend,
  getMetricsForType,
  groupEntriesByType,
  matchesHrrType,
  type ExerciseLogEntry,
  type MetricGrouping,
  type TrendPoint,
  type WorkoutBarPoint,
} from "./metrics";

export { matchesHrrType, calculateWorkoutHrr } from "./metrics";

function scaledFont(cssWidth: number, ratio: number, minPx: number, divisor: number, weight = 400): string {
  const size = Math.max(minPx, Math.round(cssWidth / divisor));
  return `${weight} ${size * ratio}px system-ui, sans-serif`;
}

function axisLabelSize(cssWidth: number, mobile: boolean): number {
  return Math.max(mobile ? 11 : 12, Math.round(cssWidth / (mobile ? 58 : 52)));
}

function visibleLabelIndices(count: number, step: number): number[] {
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index % step === 0 || index === count - 1) {
      indices.push(index);
    }
  }
  return indices;
}

function drawCenteredBarLabels(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  indices: number[],
  xForIndex: (index: number) => number,
  minX: number,
  maxX: number,
  y: number,
): void {
  ctx.textAlign = "center";
  indices.forEach((index) => {
    const label = labels[index]!;
    const idealX = xForIndex(index);
    const halfWidth = ctx.measureText(label).width / 2;
    const x = Math.max(minX + halfWidth, Math.min(maxX - halfWidth, idealX));
    ctx.fillText(label, x, y);
  });
}

function drawEdgeAwareLabels(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  indices: number[],
  xForIndex: (index: number) => number,
  plotLeft: number,
  plotRight: number,
  y: number,
): void {
  indices.forEach((index, visibleIndex) => {
    const isFirst = visibleIndex === 0;
    const isLast = visibleIndex === indices.length - 1;
    const label = labels[index]!;

    if (isFirst && isLast) {
      ctx.textAlign = "center";
      ctx.fillText(label, (plotLeft + plotRight) / 2, y);
      return;
    }

    if (isFirst) {
      ctx.textAlign = "left";
      ctx.fillText(label, plotLeft, y);
      return;
    }

    if (isLast) {
      ctx.textAlign = "right";
      ctx.fillText(label, plotRight, y);
      return;
    }

    ctx.textAlign = "center";
    ctx.fillText(label, xForIndex(index), y);
  });
}

type TrendLineChartProps = {
  points: Accessor<TrendPoint[]>;
  mobile: Accessor<boolean>;
  color?: string;
  unit?: string;
  yMin?: number;
  yMax?: number;
};

function yAxisPlotLeft(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  ratio: number,
  mobile: boolean,
  yMin: number,
  yMax: number,
  unit: string,
): number {
  ctx.font = scaledFont(cssWidth, ratio, 10, mobile ? 108 : 95);
  let maxWidth = 0;
  for (let index = 0; index <= 4; index += 1) {
    const value = yMax - (index / 4) * (yMax - yMin);
    maxWidth = Math.max(maxWidth, ctx.measureText(`${Math.round(value)}${unit}`).width);
  }
  return maxWidth + 10 * ratio;
}

function TrendLineChart(props: TrendLineChartProps): JSX.Element {
  let canvas!: HTMLCanvasElement;

  const draw = () => {
    const canvasEl = canvas;
    if (!canvasEl) return;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    const points = props.points();
    const rect = canvasEl.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = rect.width;
    const width = Math.round(cssWidth * ratio);
    const height = Math.round(rect.height * ratio);

    if (canvasEl.width !== width || canvasEl.height !== height) {
      canvasEl.width = width;
      canvasEl.height = height;
    }

    const basePadding = props.mobile() ? Math.max(18, Math.round(cssWidth * 0.04)) : Math.max(28, Math.round(cssWidth * 0.045));
    const xLabelPx = axisLabelSize(cssWidth, props.mobile());
    const padding = basePadding * ratio;
    const right = padding * 0.55;
    const top = padding * 0.65;
    const bottom = (basePadding + xLabelPx * 1.55) * ratio;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fffdfa";
    ctx.fillRect(0, 0, width, height);

    if (!points.length) {
      ctx.fillStyle = "#617066";
      ctx.font = scaledFont(cssWidth, ratio, 12, 90);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Not enough data yet", width / 2, height / 2);
      return;
    }

    const values = points.map((point) => point.value);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const span = Math.max(1, dataMax - dataMin);
    const yMin = props.yMin ?? Math.max(0, Math.floor(dataMin - span * 0.15));
    const yMax = props.yMax ?? Math.ceil(dataMax + span * 0.15);
    const left = yAxisPlotLeft(ctx, cssWidth, ratio, props.mobile(), yMin, yMax, props.unit || "");
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const plotBottom = top + plotHeight;
    const yForValue = (value: number) => plotBottom - ((value - yMin) / Math.max(1, yMax - yMin)) * plotHeight;

    ctx.strokeStyle = "#e5ebe6";
    ctx.lineWidth = Math.max(1, Math.round(width / 900));
    for (let index = 0; index <= 4; index += 1) {
      const y = top + (index / 4) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#617066";
    ctx.font = scaledFont(cssWidth, ratio, 10, props.mobile() ? 108 : 95);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const value = yMax - (index / 4) * (yMax - yMin);
      ctx.fillText(`${Math.round(value)}${props.unit || ""}`, left - 6 * ratio, top + (index / 4) * plotHeight);
    }

    const xForIndex = (index: number) => left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const lineColor = props.color || "#2a9d8f";

    if (points.length > 1) {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = Math.max(2.5, Math.round(width / 420));
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = xForIndex(index);
        const y = yForValue(point.value);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    points.forEach((point, index) => {
      const x = xForIndex(index);
      const y = yForValue(point.value);
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(4, Math.round(width / 180)), 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#617066";
    ctx.font = scaledFont(cssWidth, ratio, 12, 52, 600);
    ctx.textBaseline = "top";
    const labelStep = points.length > 8 ? Math.ceil(points.length / 6) : 1;
    const labelIndices = visibleLabelIndices(points.length, labelStep);
    drawEdgeAwareLabels(
      ctx,
      points.map((point) => point.label),
      labelIndices,
      xForIndex,
      left,
      left + plotWidth,
      plotBottom + 10 * ratio,
    );
  };

  createEffect(draw);

  onMount(() => {
    window.addEventListener("resize", draw);
    onCleanup(() => window.removeEventListener("resize", draw));
  });

  const chartWrapClass = () =>
    props.mobile()
      ? "aspect-[16/7] w-full min-w-0 max-w-full"
      : "aspect-[16/7] min-h-[220px] w-full min-w-0 max-w-full";

  return (
    <div class={chartWrapClass()}>
      <canvas ref={canvas} class="block h-full w-full min-w-0 max-w-full rounded-lg border border-[#dbe2dc] bg-[#fffdfa]" aria-label="Trend line chart" />
    </div>
  );
}

type WorkoutBarChartProps = {
  points: Accessor<WorkoutBarPoint[]>;
  mobile: Accessor<boolean>;
  color?: string;
};

function WorkoutBarChart(props: WorkoutBarChartProps): JSX.Element {
  let canvas!: HTMLCanvasElement;

  const draw = () => {
    const canvasEl = canvas;
    if (!canvasEl) return;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;

    const points = props.points();
    const rect = canvasEl.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = rect.width;
    const width = Math.round(cssWidth * ratio);
    const height = Math.round(rect.height * ratio);

    if (canvasEl.width !== width || canvasEl.height !== height) {
      canvasEl.width = width;
      canvasEl.height = height;
    }

    const basePadding = props.mobile() ? Math.max(18, Math.round(cssWidth * 0.04)) : Math.max(28, Math.round(cssWidth * 0.045));
    const xLabelPx = axisLabelSize(cssWidth, props.mobile());
    const padding = basePadding * ratio;
    const left = padding * 1.2;
    const right = padding * 0.45;
    const top = padding * 0.65;
    const bottom = (basePadding + xLabelPx * 1.55) * ratio;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const plotBottom = top + plotHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fffdfa";
    ctx.fillRect(0, 0, width, height);

    if (!points.length) {
      ctx.fillStyle = "#617066";
      ctx.font = scaledFont(cssWidth, ratio, 12, 90);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Not enough data yet", width / 2, height / 2);
      return;
    }

    const maxValue = Math.max(...points.map((point) => point.value), 1);
    const barGap = Math.max(2, Math.round(plotWidth / (points.length * 8)));
    const barWidth = Math.max(6, (plotWidth - barGap * (points.length + 1)) / points.length);
    const barColor = props.color || "#d9184b";

    ctx.strokeStyle = "#e5ebe6";
    ctx.lineWidth = Math.max(1, Math.round(width / 900));
    ctx.beginPath();
    ctx.moveTo(left, plotBottom);
    ctx.lineTo(left + plotWidth, plotBottom);
    ctx.stroke();

    points.forEach((point, index) => {
      const barHeight = (point.value / maxValue) * plotHeight;
      const x = left + barGap + index * (barWidth + barGap);
      const y = plotBottom - barHeight;
      ctx.fillStyle = barColor;
      ctx.fillRect(x, y, barWidth, barHeight);
    });

    ctx.fillStyle = "#617066";
    ctx.font = scaledFont(cssWidth, ratio, 12, 52, 600);
    ctx.textBaseline = "top";
    const labelStep = points.length > 10 ? Math.ceil(points.length / 8) : 1;
    const labelIndices = visibleLabelIndices(points.length, labelStep);
    const xForBar = (index: number) => left + barGap + index * (barWidth + barGap) + barWidth / 2;
    drawCenteredBarLabels(
      ctx,
      points.map((point) => point.label),
      labelIndices,
      xForBar,
      4 * ratio,
      width - 4 * ratio,
      plotBottom + 10 * ratio,
    );
  };

  createEffect(draw);

  onMount(() => {
    window.addEventListener("resize", draw);
    onCleanup(() => window.removeEventListener("resize", draw));
  });

  const chartWrapClass = () =>
    props.mobile()
      ? "aspect-[16/7] w-full min-w-0 max-w-full"
      : "aspect-[16/7] min-h-[220px] w-full min-w-0 max-w-full";

  return (
    <div class={chartWrapClass()}>
      <canvas ref={canvas} class="block h-full w-full min-w-0 max-w-full rounded-lg border border-[#dbe2dc] bg-[#fffdfa]" aria-label="Workout bar chart" />
    </div>
  );
}

type TypeMetricsSectionProps = {
  type: string;
  entries: ExerciseLogEntry[];
  grouping: Accessor<MetricGrouping>;
  mobile: Accessor<boolean>;
};

function TypeMetricsSection(props: TypeMetricsSectionProps): JSX.Element {
  const exerciseType = () => (props.type === "Untyped" ? undefined : props.type);
  const metrics = createMemo(() => getMetricsForType(exerciseType()));
  const zone2Trend = createMemo(() => buildZone2Trend(props.entries, props.grouping()));
  const hrrTrend = createMemo(() => buildHrrTrend(props.entries, props.grouping()));
  const trimpBars = createMemo(() => buildTrimpBars(props.entries));

  return (
    <section class="min-w-0 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] p-4" data-testid={`metrics-section-${props.type.replace(/\s+/g, "-").toLowerCase()}`}>
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="m-0 text-[1.05rem] font-extrabold text-[#172019]">{props.type}</h3>
        <span class="text-[0.78rem] font-bold text-[#617066]">{props.entries.length} workout{props.entries.length === 1 ? "" : "s"}</span>
      </div>

      <div class="grid gap-4">
        <Show when={metrics().includes("zone2")}>
          <article class="min-w-0" data-testid="metrics-zone2-chart">
            <div class="mb-2">
              <p class="m-0 text-[0.82rem] font-extrabold uppercase tracking-[0.03em] text-[#617066]">Zone 2 adherence</p>
              <p class="m-0 mt-0.5 text-[0.78rem] font-semibold text-[#617066]">Share of session time in Zone 2 — aerobic base expansion</p>
            </div>
            <TrendLineChart points={zone2Trend} mobile={props.mobile} color="#2a9d8f" unit="%" yMin={0} yMax={100} />
          </article>
        </Show>

        <Show when={metrics().includes("hrr")}>
          <article class="min-w-0" data-testid="metrics-hrr-chart">
            <div class="mb-2">
              <p class="m-0 text-[0.82rem] font-extrabold uppercase tracking-[0.03em] text-[#617066]">HRR 1 min</p>
              <p class="m-0 mt-0.5 text-[0.78rem] font-semibold text-[#617066]">Peak HR minus HR one minute later — parasympathetic recovery</p>
            </div>
            <TrendLineChart points={hrrTrend} mobile={props.mobile} color="#f77f00" unit="" />
          </article>
        </Show>

        <Show when={metrics().includes("trimp")}>
          <article class="min-w-0" data-testid="metrics-trimp-chart">
            <div class="mb-2">
              <p class="m-0 text-[0.82rem] font-extrabold uppercase tracking-[0.03em] text-[#617066]">Training load (TRIMP)</p>
              <p class="m-0 mt-0.5 text-[0.78rem] font-semibold text-[#617066]">Cumulative stress: time in each zone × zone coefficient</p>
            </div>
            <WorkoutBarChart points={trimpBars} mobile={props.mobile} />
          </article>
        </Show>
      </div>
    </section>
  );
}

type MetricsViewProps = {
  entries: Accessor<ExerciseLogEntry[]>;
  mobile: Accessor<boolean>;
};

function MetricsView(props: MetricsViewProps): JSX.Element {
  const [grouping, setGrouping] = createSignal<MetricGrouping>("week");
  const typeGroups = createMemo(() => groupEntriesByType(props.entries()));

  return (
    <div class="min-w-0 space-y-4" data-testid="metrics-view">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="m-0 text-[0.95rem] font-extrabold text-[#172019]">Metrics by exercise type</p>
        <label class="grid gap-1">
          <span class="text-[0.72rem] font-bold uppercase tracking-[0.04em] text-[#617066]">Trend grouping</span>
          <select
            data-testid="metrics-grouping"
            class="min-h-9 rounded-lg border border-[#dbe2dc] bg-white px-2.5 text-[0.85rem] font-bold text-[#172019]"
            value={grouping()}
            onChange={(event) => setGrouping(event.currentTarget.value as MetricGrouping)}
          >
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>
        </label>
      </div>

      <Show when={typeGroups().length} fallback={<p data-testid="metrics-empty" class="m-0 rounded-lg border border-[#dbe2dc] bg-[#fbfcfb] p-4 text-sm font-semibold text-[#617066]">Complete a workout and assign an exercise type to see metrics.</p>}>
        <For each={typeGroups()}>
          {(group) => (
            <TypeMetricsSection type={group.type} entries={group.entries} grouping={grouping} mobile={props.mobile} />
          )}
        </For>
      </Show>
    </div>
  );
}

export default MetricsView;
