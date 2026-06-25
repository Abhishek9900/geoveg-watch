"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import type { AreaHistoryResponse, YearReading } from "@/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { activeYearChanged } from "@/store/areaSlice";
import { layerChanged, type LayerKey } from "@/store/layerSlice";

interface TimelinePanelProps {
  history: AreaHistoryResponse;
  activeYear: number;
}

const PLAYBACK_INTERVAL_MS = 1100;

const LAYER_TABS: { key: LayerKey; label: string }[] = [
  { key: "green", label: "Vegetation" },
  { key: "water", label: "Water" },
  { key: "moisture", label: "Moisture" },
  { key: "burn", label: "Disturbance" },
  { key: "sar", label: "Radar" },
];

export default function TimelinePanel({ history, activeYear }: TimelinePanelProps) {
  const dispatch = useAppDispatch();
  const activeLayer = useAppSelector((s) => s.layer.activeLayer);
  const [isPlaying, setIsPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const years = history.years;
  const activeIndex = years.findIndex((y) => y.year === activeYear);

  useEffect(() => {
    if (!isPlaying) return;
    const currentIdx = years.findIndex((y) => y.year === activeYear);
    const nextIdx = currentIdx + 1 >= years.length ? 0 : currentIdx + 1;

    intervalRef.current = setTimeout(() => {
      dispatch(activeYearChanged(years[nextIdx].year));
    }, PLAYBACK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
    // Re-running this effect on every activeYear change is intentional: each step
    // schedules exactly one advance to the next year (wrapping to the first year
    // after the last, so playback loops continuously rather than stopping), then
    // the resulting activeYear change re-triggers this effect to schedule the
    // following step — a clearer mental model than reusing setInterval with a
    // stale closure over activeYear.
    // The end-of-range setIsPlaying call lives inside the timeout callback (an async
    // boundary), not the effect body itself, since calling setState synchronously in
    // an effect body risks cascading renders.
  }, [isPlaying, years, dispatch, activeYear]);

  const chartData = useMemo(
    () =>
      years.map((y) => ({
        year: y.year,
        green: y.greenCoverPct,
        water: y.waterCoverPct,
        ndmi: y.ndmi !== null ? y.ndmi * 100 : null,
        nbr: y.nbr !== null ? y.nbr * 100 : null,
        sarVv: y.sarBackscatterVvDb,
      })),
    [years]
  );

  const activeReading: YearReading | undefined = years[activeIndex];
  const firstValid = years.find((y) => y.greenCoverPct !== null);
  const overallDelta =
    firstValid && activeReading && activeReading.greenCoverPct !== null && firstValid.greenCoverPct !== null
      ? round(activeReading.greenCoverPct - firstValid.greenCoverPct, 1)
      : null;

  const goToIndex = (idx: number) => {
    const clamped = Math.min(years.length - 1, Math.max(0, idx));
    dispatch(activeYearChanged(years[clamped].year));
  };

  const chartSeries = LAYER_SERIES[activeLayer];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-1">
        {LAYER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => dispatch(layerChanged(tab.key))}
            className={`flex-1 rounded-md py-1.5 text-[11px] font-medium transition-colors ${
              activeLayer === tab.key
                ? "bg-[var(--accent)] text-[#1a1408]"
                : "text-[var(--text-faint)] hover:text-[var(--text-dim)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Green cover (this year)"
          value={activeReading?.greenCoverPct}
          unit="%"
          accent="var(--accent)"
        />
        <StatCard
          label={`Change since ${firstValid?.year ?? "—"}`}
          value={overallDelta}
          unit=" pts"
          accent={overallDelta !== null && overallDelta < 0 ? "var(--loss)" : "var(--accent)"}
          signed
        />
        <StatCard
          label="Water cover"
          value={activeReading?.waterCoverPct}
          unit="%"
          accent="var(--water)"
          hint="Share of sample points classified as open water (NDWI/SCL). 0% is expected for areas without rivers, lakes, or wetlands inside the drawn polygon."
        />
        <StatCard label="NDMI (moisture)" value={activeReading?.ndmi} unit="" accent="var(--moisture)" />
        <StatCard label="NBR (disturbance)" value={activeReading?.nbr} unit="" accent="var(--burn)" />
        <StatCard
          label="SAR VV backscatter"
          value={activeReading?.sarBackscatterVvDb}
          unit=" dB"
          accent="var(--sar)"
        />
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-3">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="seriesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartSeries.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={chartSeries.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="year"
              stroke="var(--text-faint)"
              tick={{ fontSize: 11, fill: "var(--text-faint)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              domain={chartSeries.domain}
              stroke="var(--text-faint)"
              tick={{ fontSize: 11, fill: "var(--text-faint)" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "var(--bg-panel-raised)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--text)" }}
            />
            <ReferenceLine x={activeYear} stroke="var(--text-dim)" strokeDasharray="4 2" />
            <Area
              type="monotone"
              dataKey={chartSeries.dataKey}
              name={chartSeries.label}
              stroke={chartSeries.color}
              strokeWidth={2}
              fill="url(#seriesFill)"
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToIndex(activeIndex - 1)}
            className="rounded-md border border-[var(--line)] p-1.5 text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]"
            aria-label="Previous year"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="rounded-md border border-[var(--accent-strong)] bg-[var(--accent-strong)]/10 p-1.5 text-[var(--accent)] hover:bg-[var(--accent-strong)]/20"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={() => goToIndex(activeIndex + 1)}
            className="rounded-md border border-[var(--line)] p-1.5 text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]"
            aria-label="Next year"
          >
            <SkipForward size={14} />
          </button>
          <span className="font-mono text-sm text-[var(--text)] ml-1">{activeYear}</span>
          {activeReading?.isGapFilled && (
            <span className="text-[10px] text-[var(--loss)] ml-auto">no scene found</span>
          )}
        </div>

        <input
          type="range"
          min={0}
          max={years.length - 1}
          step={1}
          value={Math.max(0, activeIndex)}
          onChange={(e) => goToIndex(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[10px] font-mono text-[var(--text-faint)]">
          <span>{years[0]?.year}</span>
          <span>{years[years.length - 1]?.year}</span>
        </div>
      </div>

      {activeReading && (
        <div className="text-[11px] text-[var(--text-faint)] font-mono leading-relaxed">
          {activeReading.opticalSceneId && (
            <div>
              Optical: {activeReading.opticalSceneId} ·{" "}
              {activeReading.opticalSceneDate ? new Date(activeReading.opticalSceneDate).toLocaleDateString() : "—"}
            </div>
          )}
          {activeReading.sarSceneId && (
            <div>
              SAR: {activeReading.sarSceneId} ·{" "}
              {activeReading.sarSceneDate ? new Date(activeReading.sarSceneDate).toLocaleDateString() : "—"}
            </div>
          )}
          {activeReading.note && <div className="text-[var(--loss)] mt-1">{activeReading.note}</div>}
        </div>
      )}
    </div>
  );
}

const LAYER_SERIES: Record<
  LayerKey,
  { dataKey: string; label: string; color: string; domain: [number, number] }
> = {
  green: { dataKey: "green", label: "Green cover %", color: "var(--accent)", domain: [0, 100] },
  water: { dataKey: "water", label: "Water cover %", color: "var(--water)", domain: [0, 100] },
  moisture: { dataKey: "ndmi", label: "NDMI ×100", color: "var(--moisture)", domain: [-100, 100] },
  burn: { dataKey: "nbr", label: "NBR ×100", color: "var(--burn)", domain: [-100, 100] },
  sar: { dataKey: "sarVv", label: "SAR VV (dB)", color: "var(--sar)", domain: [-25, 5] },
};

function StatCard({
  label,
  value,
  unit,
  accent,
  signed = false,
  hint,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  accent: string;
  signed?: boolean;
  hint?: string;
}) {
  const display =
    value === null || value === undefined
      ? "—"
      : `${signed && value > 0 ? "+" : ""}${value}${unit}`;
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2.5" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
      <div className="font-display text-lg mt-0.5" style={{ color: accent }}>
        {display}
      </div>
    </div>
  );
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
