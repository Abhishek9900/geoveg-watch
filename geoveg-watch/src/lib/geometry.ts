import type { AreaPolygon, LngLatRing } from "@/types";

const EARTH_RADIUS_M = 6_371_008.8;

/** Bounding box as [minLng, minLat, maxLng, maxLat]. */
export type BBox = [number, number, number, number];

export function ringBBox(ring: LngLatRing): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function polygonBBox(polygon: AreaPolygon): BBox {
  return ringBBox(polygon.coordinates[0]);
}

/** Ray-casting point-in-polygon test for the outer ring (holes ignored, not needed here). */
export function pointInRing(point: [number, number], ring: LngLatRing): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: [number, number], polygon: AreaPolygon): boolean {
  return pointInRing(point, polygon.coordinates[0]);
}

/** Approximate centroid via the average of ring vertices (sufficient for sampling/center purposes). */
export function approximateCentroid(polygon: AreaPolygon): [number, number] {
  const ring = polygon.coordinates[0];
  let sumLng = 0;
  let sumLat = 0;
  const n = ring.length - 1; // last point duplicates first in a closed ring
  for (let i = 0; i < n; i++) {
    sumLng += ring[i][0];
    sumLat += ring[i][1];
  }
  return [sumLng / n, sumLat / n];
}

/**
 * Approximate planar area of a polygon in hectares using an equirectangular
 * projection scaled by latitude. Adequate for the small/medium AOIs this app targets
 * (a few hectares to a few thousand km^2); not geodesically exact for very large areas.
 */
export function polygonAreaHectares(polygon: AreaPolygon): number {
  const ring = polygon.coordinates[0];
  const [, minLat, , maxLat] = ringBBox(ring);
  const midLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metersPerDegLng = metersPerDegLat * Math.cos(midLatRad);

  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    const x1 = lng1 * metersPerDegLng;
    const y1 = lat1 * metersPerDegLat;
    const x2 = lng2 * metersPerDegLng;
    const y2 = lat2 * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  const squareMeters = Math.abs(area) / 2;
  return squareMeters / 10_000;
}

/**
 * Generate a regular grid of sample points inside the polygon's bounding box,
 * keeping only points that fall inside the polygon. Falls back to the centroid
 * if the grid yields too few interior points (e.g. very thin/small polygons).
 */
export function generateSamplePoints(
  polygon: AreaPolygon,
  targetCount: number
): [number, number][] {
  const [minLng, minLat, maxLng, maxLat] = polygonBBox(polygon);
  const lngSpan = Math.max(maxLng - minLng, 1e-6);
  const latSpan = Math.max(maxLat - minLat, 1e-6);

  // Choose grid resolution so rows*cols is in the neighborhood of targetCount,
  // respecting the bbox aspect ratio so cells stay roughly square in degrees.
  const aspect = lngSpan / latSpan;
  const rows = Math.max(1, Math.round(Math.sqrt(targetCount / aspect)));
  const cols = Math.max(1, Math.round(targetCount / rows));

  const points: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const lat = minLat + ((r + 0.5) / rows) * latSpan;
    for (let c = 0; c < cols; c++) {
      const lng = minLng + ((c + 0.5) / cols) * lngSpan;
      if (pointInPolygon([lng, lat], polygon)) {
        points.push([lng, lat]);
      }
    }
  }

  if (points.length === 0) {
    points.push(approximateCentroid(polygon));
  }
  return points;
}

/** Expand a bbox by a small margin (in degrees) to ensure STAC search covers edge pixels. */
export function padBBox(bbox: BBox, marginDeg = 0.01): BBox {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [minLng - marginDeg, minLat - marginDeg, maxLng + marginDeg, maxLat + marginDeg];
}

export function isValidPolygon(polygon: unknown): polygon is AreaPolygon {
  if (
    typeof polygon !== "object" ||
    polygon === null ||
    (polygon as { type?: unknown }).type !== "Polygon"
  ) {
    return false;
  }
  const coords = (polygon as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return false;
  const ring = coords[0];
  if (!Array.isArray(ring) || ring.length < 4) return false;
  return ring.every(
    (pt) =>
      Array.isArray(pt) &&
      pt.length === 2 &&
      typeof pt[0] === "number" &&
      typeof pt[1] === "number" &&
      pt[0] >= -180 &&
      pt[0] <= 180 &&
      pt[1] >= -90 &&
      pt[1] <= 90
  );
}
