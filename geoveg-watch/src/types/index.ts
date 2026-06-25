// Core domain types shared across the app, mirroring the FastAPI backend's response shapes.

/** A GeoJSON-style ring of [lng, lat] pairs, closed (first === last). */
export type LngLatRing = [number, number][];

/** Minimal polygon geometry, matching GeoJSON Polygon (single ring, no holes). */
export interface AreaPolygon {
  type: "Polygon";
  coordinates: LngLatRing[];
}

/** One year of computed environmental indicators for an area, combining optical + SAR sources. */
export interface YearReading {
  year: number;
  /** Mean NDVI (-1..1) — vegetation greenness/health. Null if no usable optical scene found. */
  ndvi: number | null;
  /** Mean NDWI (-1..1) — surface water / wetness. */
  ndwi: number | null;
  /** Mean NDMI (-1..1) — vegetation moisture content (drought stress indicator). */
  ndmi: number | null;
  /** Mean NBR (-1..1) — burn/disturbance severity (lower = more disturbed/burned). */
  nbr: number | null;
  /** Mean EVI — enhanced vegetation index, more robust than NDVI in dense canopy. */
  evi: number | null;
  /** Share of sampled points classified as "green cover" (NDVI above threshold), 0..100. */
  greenCoverPct: number | null;
  /** Share of sampled points classified as water/very moist, 0..100. */
  waterCoverPct: number | null;
  /** Share of sampled points classified as bare soil / non-vegetated, non-water, 0..100. */
  bareSoilPct: number | null;
  /** Mean calibrated Sentinel-1 VV backscatter in dB. Cloud-penetrating; fills optical gaps. */
  sarBackscatterVvDb: number | null;
  /** Mean calibrated Sentinel-1 VH backscatter in dB. */
  sarBackscatterVhDb: number | null;
  opticalSceneId: string | null;
  opticalSceneDate: string | null;
  cloudCoverPct: number | null;
  sarSceneId: string | null;
  sarSceneDate: string | null;
  /** True if neither optical nor SAR data could be found for this year. */
  isGapFilled: boolean;
  /** Human-readable explanation when data is partial or missing. */
  note: string | null;
}

/** Year-over-year change derived from two consecutive YearReadings. */
export interface YearDelta {
  year: number;
  greenCoverDeltaPct: number | null;
  waterCoverDeltaPct: number | null;
  classification: "gain" | "loss" | "stable" | "unknown";
}

export interface AreaHistoryResponse {
  area: {
    polygon: AreaPolygon;
    areaHectares: number;
    centroid: [number, number];
  };
  /** Inclusive first and last year for which data could be searched. */
  availableRange: { from: number; to: number };
  years: YearReading[];
  deltas: YearDelta[];
  meta: {
    sampledPoints: number;
    opticalSource: string;
    sarSource: string;
    generatedAt: string;
  };
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lon: number;
  boundingBox: [number, number, number, number] | null;
}

export interface ApiErrorBody {
  error: {
    message: string;
    code: string;
  };
}

export class AreaHistoryError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 500) {
    super(message);
    this.name = "AreaHistoryError";
  }
}
