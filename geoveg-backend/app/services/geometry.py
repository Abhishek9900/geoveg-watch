"""Geometry helpers built on shapely + pyproj for accurate area and sampling math."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from pyproj import Transformer
from shapely.geometry import Point, Polygon, shape

BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class PreparedArea:
    """A polygon plus precomputed helpers needed repeatedly during analysis."""

    polygon: Polygon
    bbox: BBox
    centroid: tuple[float, float]  # (lng, lat)
    area_hectares: float


def prepare_area(geojson_polygon: dict) -> PreparedArea:
    polygon = shape(geojson_polygon)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)  # common fix for self-intersecting rings
    bbox = polygon.bounds  # (minx, miny, maxx, maxy) == (minLng, minLat, maxLng, maxLat)
    centroid = polygon.centroid
    area_ha = _geodesic_area_hectares(polygon)
    return PreparedArea(
        polygon=polygon,
        bbox=bbox,
        centroid=(centroid.x, centroid.y),
        area_hectares=area_ha,
    )


def _geodesic_area_hectares(polygon: Polygon) -> float:
    """
    Project to an equal-area projection (Azimuthal Equidistant centered on the
    polygon's own centroid) before measuring area, which keeps distortion low
    for the small/medium AOIs this app targets without needing a global equal-area grid.
    """
    centroid = polygon.centroid
    proj_str = (
        f"+proj=aeqd +lat_0={centroid.y} +lon_0={centroid.x} "
        "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    )
    transformer = Transformer.from_crs("EPSG:4326", proj_str, always_xy=True)
    xs, ys = transformer.transform(*polygon.exterior.coords.xy)
    projected = Polygon(zip(xs, ys))
    return projected.area / 10_000


def generate_sample_points(polygon: Polygon, target_count: int) -> list[tuple[float, float]]:
    """
    Regular grid of points inside the polygon's bbox, kept only if inside the polygon.
    Falls back to the centroid if the grid produces no interior points (thin/small AOIs).
    """
    minx, miny, maxx, maxy = polygon.bounds
    lng_span = max(maxx - minx, 1e-9)
    lat_span = max(maxy - miny, 1e-9)
    aspect = lng_span / lat_span

    rows = max(1, round((target_count / aspect) ** 0.5))
    cols = max(1, round(target_count / rows))

    lats = miny + (np.arange(rows) + 0.5) / rows * lat_span
    lngs = minx + (np.arange(cols) + 0.5) / cols * lng_span

    points: list[tuple[float, float]] = []
    for lat in lats:
        for lng in lngs:
            if polygon.contains(Point(lng, lat)):
                points.append((float(lng), float(lat)))

    if not points:
        c = polygon.centroid
        points.append((float(c.x), float(c.y)))
    return points


def pad_bbox(bbox: BBox, margin_deg: float = 0.005) -> BBox:
    minx, miny, maxx, maxy = bbox
    return (minx - margin_deg, miny - margin_deg, maxx + margin_deg, maxy + margin_deg)
