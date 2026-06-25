"use client";

import { Loader2, MapPinned, AlertTriangle } from "lucide-react";
import type { AreaPolygon } from "@/types";
import { polygonAreaHectares, approximateCentroid } from "@/lib/geometry";

interface AreaSelectionPanelProps {
  polygon: AreaPolygon | null;
  isLoading: boolean;
  elapsedSeconds: number | null;
  error: string | null;
  onLoadHistory: () => void;
}

export default function AreaSelectionPanel({
  polygon,
  isLoading,
  elapsedSeconds,
  error,
  onLoadHistory,
}: AreaSelectionPanelProps) {
  if (!polygon) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-12 text-[var(--text-faint)]">
        <MapPinned size={28} />
        <p className="text-sm max-w-xs">
          Draw a polygon or rectangle on the map, or search a place name, to select the area you want
          to analyze.
        </p>
      </div>
    );
  }

  const hectares = polygonAreaHectares(polygon);
  const [lng, lat] = approximateCentroid(polygon);
  const sizeWarning = hectares > 35_000;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] p-3 text-sm">
        <div className="flex justify-between text-[var(--text-dim)]">
          <span>Area size</span>
          <span className="font-mono text-[var(--text)]">{formatHectares(hectares)}</span>
        </div>
        <div className="flex justify-between text-[var(--text-dim)] mt-1">
          <span>Centroid</span>
          <span className="font-mono text-[var(--text)]">
            {lat.toFixed(3)}, {lng.toFixed(3)}
          </span>
        </div>
      </div>

      {sizeWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--loss)]/40 bg-[var(--loss)]/10 px-3 py-2 text-xs text-[var(--loss)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>This area is large — analysis may be slow or lower-resolution. Areas over ~50,000 ha will be rejected.</span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--loss)]/40 bg-[var(--loss)]/10 px-3 py-2 text-xs text-[var(--loss)]">
          {error}
        </div>
      )}

      <button
        onClick={onLoadHistory}
        disabled={isLoading}
        className="flex items-center justify-center gap-2 rounded-lg bg-[var(--accent-strong)] py-2.5 text-sm font-medium text-[#1a1408] hover:bg-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? (
          <>
            <Loader2 size={15} className="animate-spin" />
            {elapsedSeconds !== null ? `Reading satellite data… (${elapsedSeconds}s)` : "Reading satellite data…"}
          </>
        ) : (
          "Load satellite history"
        )}
      </button>

      {isLoading && (
        <p className="text-[11px] text-[var(--text-faint)] text-center">
          First load reads real Sentinel-2 imagery year by year — this can take a little while.
          Results are cached for next time.
        </p>
      )}
    </div>
  );
}

function formatHectares(ha: number): string {
  if (ha < 1) return `${(ha * 10_000).toFixed(0)} m²`;
  if (ha >= 100) return `${ha.toLocaleString(undefined, { maximumFractionDigits: 0 })} ha`;
  return `${ha.toFixed(1)} ha`;
}
