"use client";

import { useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Leaf } from "lucide-react";
import { AreaHistoryError } from "@/types";
import { fetchAreaHistory } from "@/lib/api-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  backToSelection,
  historyRequestFailed,
  historyRequestStarted,
  historyRequestSucceeded,
  historyRequestTick,
} from "@/store/areaSlice";
import AreaSelectionPanel from "@/components/AreaSelectionPanel";
import TimelinePanel from "@/components/TimelinePanel";

// MapLibre touches window/document at import time, so it must never be server-rendered.
const AreaMap = dynamic(() => import("@/components/AreaMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)] text-sm">
      Loading map…
    </div>
  ),
});

export default function Home() {
  const dispatch = useAppDispatch();
  const selectedPolygon = useAppSelector((s) => s.area.selectedPolygon);
  const history = useAppSelector((s) => s.area.history);
  const activeYear = useAppSelector((s) => s.area.activeYear);
  const isLoading = useAppSelector((s) => s.area.isLoading);
  const elapsedSeconds = useAppSelector((s) => s.area.elapsedSeconds);
  const error = useAppSelector((s) => s.area.error);

  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async () => {
    if (!selectedPolygon) return;
    dispatch(historyRequestStarted());
    elapsedTimerRef.current = setInterval(() => dispatch(historyRequestTick()), 1000);

    try {
      const data = await fetchAreaHistory(selectedPolygon);
      dispatch(historyRequestSucceeded(data));
    } catch (err) {
      const message =
        err instanceof AreaHistoryError ? err.message : "Something went wrong loading the history.";
      dispatch(historyRequestFailed(message));
    } finally {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    }
  }, [selectedPolygon, dispatch]);

  const activeReading = history?.years.find((y) => y.year === activeYear) ?? null;
  const tintRatio =
    activeReading?.greenCoverPct !== null && activeReading?.greenCoverPct !== undefined
      ? Math.min(1, Math.max(0, activeReading.greenCoverPct / 100))
      : null;

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--line)] bg-[var(--bg-panel)] shrink-0">
        <Leaf size={18} className="text-[var(--accent)]" />
        <h1 className="font-display text-base tracking-tight">GeoVeg Watch</h1>
        <span className="text-[11px] text-[var(--text-faint)] ml-1">
          Optical &amp; radar satellite land-change trends, year by year
        </span>
      </header>

      <main className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <AreaMap yearTintRatio={tintRatio} />
        </div>

        <aside className="w-[400px] shrink-0 border-l border-[var(--line)] bg-[var(--bg)] overflow-y-auto p-4">
          {!history ? (
            <AreaSelectionPanel
              polygon={selectedPolygon}
              isLoading={isLoading}
              elapsedSeconds={elapsedSeconds}
              error={error}
              onLoadHistory={loadHistory}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => dispatch(backToSelection())}
                className="text-xs text-[var(--text-faint)] hover:text-[var(--text-dim)] self-start"
              >
                ← Select a different area
              </button>
              <TimelinePanel history={history} activeYear={activeYear ?? history.availableRange.to} />
              <p className="text-[10px] text-[var(--text-faint)] leading-relaxed">
                Optical source: {history.meta.opticalSource}. SAR source: {history.meta.sarSource}.{" "}
                {history.meta.sampledPoints} sample points per year. Indices are derived from
                threshold rules on the least-cloudy available scene per year and are an
                approximation, not an official land-cover classification.
              </p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
