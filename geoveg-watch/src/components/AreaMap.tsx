"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import DrawRectangle from "mapbox-gl-draw-rectangle-mode";
import type { AreaPolygon, GeocodeResult } from "@/types";
import { fetchGeocodeResults } from "@/lib/api-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { areaSelected } from "@/store/areaSlice";
import { Search, Pencil, Trash2, Square } from "lucide-react";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * The "liberty" style is the actively-maintained OpenFreeMap basemap, but it's a bright
 * daytime style. Rather than apply a canvas-wide CSS filter (which would also invert our
 * own draw-layer colors, forcing fragile pre-inverted hex values), fetch the style JSON
 * and darken it properly at the MapLibre style-spec level: background/water/land-use
 * fills get darkened, while roads and labels keep their own styling for contrast. This
 * is the idiomatic way to theme a vector basemap and leaves draw-layer colors untouched.
 */
async function loadDarkenedLibertyStyle(): Promise<maplibregl.StyleSpecification> {
  const response = await fetch(MAP_STYLE_URL);
  const style = (await response.json()) as maplibregl.StyleSpecification;

  const DARK_BG = "#1a1d23";
  const DARK_WATER = "#11151c";
  const DARK_LANDUSE = "#20242c";

  for (const layer of style.layers) {
    if (layer.type === "background") {
      layer.paint = { ...layer.paint, "background-color": DARK_BG };
    } else if (layer.type === "fill" && "paint" in layer) {
      const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
      if (sourceLayer === "water") {
        layer.paint = { ...layer.paint, "fill-color": DARK_WATER };
      } else if (sourceLayer === "landuse" || sourceLayer === "landcover" || sourceLayer === "park") {
        layer.paint = { ...layer.paint, "fill-color": DARK_LANDUSE };
      }
    }
  }

  return style;
}
const DEFAULT_CENTER: [number, number] = [10.3, 50.8]; // Germany-ish, matches the research context
const DEFAULT_ZOOM = 6;

// MapboxDraw ships CSS class names tied to mapbox-gl's DOM structure, typed as readonly
// string literals. MapLibre kept the same DOM shape but renamed its own classes, so
// remapping these constants — and widening the type to allow it — is the officially
// documented way to make mapbox-gl-draw work on MapLibre (see MapLibre's own
// "Draw polygon with mapbox-gl-draw" example).
const drawClasses = MapboxDraw.constants.classes as Record<string, string>;
drawClasses.CANVAS = "maplibregl-canvas";
drawClasses.CONTROL_BASE = "maplibregl-ctrl";
drawClasses.CONTROL_PREFIX = "maplibregl-ctrl-";
drawClasses.CONTROL_GROUP = "maplibregl-ctrl-group";
drawClasses.ATTRIBUTION = "maplibregl-ctrl-attrib";

interface DrawFeature {
  geometry: { type: string; coordinates: number[][][] };
}

function drawFeatureToPolygon(feature: DrawFeature): AreaPolygon {
  const ring = feature.geometry.coordinates[0] as unknown as [number, number][];
  return { type: "Polygon", coordinates: [ring] };
}

function tintColor(ratio: number | null): string {
  if (ratio === null) return "#9fb3cc"; // cool slate-blue, clearly visible, no warm tones
  if (ratio >= 0.5) {
    const t = (ratio - 0.5) * 2;
    return mix("#7d8ba3", "#5ec48f", t);
  }
  const t = ratio * 2;
  return mix("#e0654f", "#7d8ba3", t);
}

function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

interface AreaMapProps {
  yearTintRatio: number | null;
}

export default function AreaMap({ yearTintRatio }: AreaMapProps) {
  const dispatch = useAppDispatch();
  const selectedPolygon = useAppSelector((s) => s.area.selectedPolygon);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isRectangleMode, setIsRectangleMode] = useState(false);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;
    let cancelled = false;

    (async () => {
      const style = await loadDarkenedLibertyStyle();
      if (cancelled || !mapContainerRef.current) return;

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: "simple_select",
        styles: DRAW_STYLES,
        // mapbox-gl-draw ships only polygon/line/point modes; a rectangle/bounding-box
        // tool requires this separate, widely-used custom-mode plugin. The plugin
        // can't register its own toolbar button, so a button is added manually below.
        modes: { ...MapboxDraw.modes, draw_rectangle: DrawRectangle as unknown as MapboxDraw.DrawCustomMode },
      });
      // @mapbox/mapbox-gl-draw's published types import from "mapbox-gl", which is
      // structurally incompatible with maplibre-gl's Map type even though the two
      // libraries are runtime-compatible (MapLibre is a pre-fork-license fork of
      // Mapbox GL JS and mapbox-gl-draw only touches the stable parts of that surface).
      // This cast is the one place that type mismatch needs to be bridged.
      map.addControl(draw as unknown as maplibregl.IControl, "top-left");
      drawRef.current = draw;

      const handleDrawChange = () => {
        const features = draw.getAll().features as unknown as DrawFeature[];
        if (features.length === 0) return;
        // Keep only the most recently drawn polygon — a single-AOI workflow.
        const latest = features[features.length - 1];
        if (features.length > 1) {
          const idsToRemove = (draw.getAll().features as unknown as { id: string }[])
            .slice(0, -1)
            .map((f) => f.id);
          draw.delete(idsToRemove);
        }
        dispatch(areaSelected(drawFeatureToPolygon(latest)));
        setIsRectangleMode(false);
      };

      map.on("draw.create" as never, handleDrawChange);
      map.on("draw.update" as never, handleDrawChange);
      map.on("draw.modechange" as never, ((e: { mode: string }) => {
        setIsRectangleMode(e.mode === "draw_rectangle");
      }) as never);

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // dispatch is stable; intentionally only running this setup once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolor the drawn polygon's fill when the active year's gain/loss ratio changes.
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    const color = tintColor(yearTintRatio);
    const layerIds = ["gl-draw-polygon-fill-inactive", "gl-draw-polygon-fill-active"];
    for (const id of layerIds) {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, "fill-color", color);
      }
    }
  }, [yearTintRatio]);

  // Programmatically draw a polygon when set via search (bbox) rather than freehand drawing.
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!selectedPolygon || !map || !draw) return;

    const currentIds = (draw.getAll().features as unknown as { id: string }[]).map((f) => f.id);
    if (currentIds.length > 0) draw.delete(currentIds);

    draw.add({
      type: "Feature",
      properties: {},
      geometry: selectedPolygon,
    } as never);

    const ring = selectedPolygon.coordinates[0];
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const bounds = new maplibregl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)]
    );
    map.fitBounds(bounds, { padding: 60, duration: 600 });
  }, [selectedPolygon]);

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await fetchGeocodeResults(searchQuery);
      setSearchResults(results);
      if (results.length === 0) setSearchError("No matching places found.");
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed.");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const pickSearchResult = useCallback(
    (result: GeocodeResult) => {
      setSearchResults([]);
      setSearchQuery(result.displayName.split(",")[0]);

      if (result.boundingBox) {
        const [minLng, minLat, maxLng, maxLat] = result.boundingBox;
        const polygon: AreaPolygon = {
          type: "Polygon",
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        };
        dispatch(areaSelected(polygon));
      } else if (mapRef.current) {
        mapRef.current.flyTo({ center: [result.lon, result.lat], zoom: 12 });
      }
    },
    [dispatch]
  );

  const clearDrawing = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const ids = (draw.getAll().features as unknown as { id: string }[]).map((f) => f.id);
    if (ids.length > 0) draw.delete(ids);
  }, []);

  const toggleRectangleMode = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (isRectangleMode) {
      draw.changeMode("simple_select");
      setIsRectangleMode(false);
    } else {
      draw.changeMode("draw_rectangle" as never);
      setIsRectangleMode(true);
    }
  }, [isRectangleMode]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />

      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex flex-col gap-2 w-full max-w-md px-14">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]/95 px-3 py-2 shadow-lg backdrop-blur">
          <Search size={16} className="text-[var(--text-faint)] shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder="Search a place, e.g. Schwarzwald, Germany"
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
          />
          <button
            onClick={runSearch}
            disabled={isSearching}
            className="text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-strong)] disabled:opacity-50 shrink-0"
          >
            {isSearching ? "…" : "Go"}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]/95 shadow-lg backdrop-blur overflow-hidden">
            {searchResults.map((r, i) => (
              <button
                key={`${r.lat}-${r.lon}-${i}`}
                onClick={() => pickSearchResult(r)}
                className="block w-full text-left px-3 py-2 text-xs text-[var(--text-dim)] hover:bg-[var(--bg-panel-raised)] hover:text-[var(--text)] border-b border-[var(--line)] last:border-b-0"
              >
                {r.displayName}
              </button>
            ))}
          </div>
        )}

        {searchError && (
          <div className="rounded-lg border border-[var(--loss)]/40 bg-[var(--bg-panel)]/95 px-3 py-2 text-xs text-[var(--loss)] backdrop-blur">
            {searchError}
          </div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)]/95 px-3 py-2 text-xs text-[var(--text-dim)] shadow-lg backdrop-blur">
        <Pencil size={14} className="text-[var(--text-faint)]" />
        <span>Polygon tool (top-left), or</span>
        <button
          onClick={toggleRectangleMode}
          className={`flex items-center gap-1 rounded-md px-2 py-1 ${
            isRectangleMode
              ? "bg-[var(--accent)] text-[#06150c]"
              : "border border-[var(--line)] text-[var(--text-dim)] hover:text-[var(--text)]"
          }`}
        >
          <Square size={12} /> Rectangle
        </button>
        <span>, or search a place above</span>
        <button
          onClick={clearDrawing}
          className="ml-2 flex items-center gap-1 text-[var(--loss)] hover:text-[var(--loss-strong)]"
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>
    </div>
  );
}

// Minimal custom draw styling so the polygon matches the instrument-panel theme
// instead of mapbox-gl-draw's default blue.
const DRAW_STYLES = [
  {
    id: "gl-draw-polygon-fill-inactive",
    type: "fill",
    filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"]],
    paint: { "fill-color": "#9fb3cc", "fill-opacity": 0.32 },
  },
  {
    id: "gl-draw-polygon-fill-active",
    type: "fill",
    filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
    paint: { "fill-color": "#9fb3cc", "fill-opacity": 0.4 },
  },
  {
    id: "gl-draw-polygon-stroke-inactive",
    type: "line",
    filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"]],
    paint: { "line-color": "#eef1f5", "line-width": 2.5 },
  },
  {
    id: "gl-draw-polygon-stroke-active",
    type: "line",
    filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
    paint: { "line-color": "#eef1f5", "line-width": 2.5, "line-dasharray": [0.2, 2] },
  },
  {
    id: "gl-draw-polygon-and-line-vertex-halo-active",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
    paint: { "circle-radius": 6, "circle-color": "#14171c" },
  },
  {
    id: "gl-draw-polygon-and-line-vertex-active",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
    paint: { "circle-radius": 4, "circle-color": "#eef1f5" },
  },
];
