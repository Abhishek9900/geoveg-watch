"""
Resolve one year's full environmental reading (optical indices + SAR backscatter) for
a polygon, trying multiple candidate scenes per source until one yields usable data.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.models.schemas import YearReading
from app.services.geometry import BBox
from app.services.optical_sampling import compute_optical_indices, sample_sentinel2_item
from app.services.sar_sampling import sample_sentinel1_polarization
from app.services.stac_search import search_sentinel1, search_sentinel2

logger = logging.getLogger(__name__)

SENTINEL2_FIRST_USABLE_YEAR = 2016  # 2015 launch year has sparse/partial coverage
SENTINEL1_FIRST_USABLE_YEAR = 2015
MAX_OPTICAL_SCENES_TO_TRY = 3
MAX_SAR_SCENES_TO_TRY = 2


def _season_window(year: int) -> tuple[str, str]:
    return f"{year}-04-01", f"{year}-10-31"


def resolve_year_reading(
    bbox: BBox, year: int, lons: list[float], lats: list[float]
) -> YearReading:
    optical_part = _resolve_optical(bbox, year, lons, lats)
    sar_part = _resolve_sar(bbox, year, lons, lats)

    has_any_data = optical_part is not None or sar_part is not None
    note = None
    if optical_part is None and sar_part is None:
        note = "No usable Sentinel-1 or Sentinel-2 scene found for this year in this area."
    elif optical_part is None:
        note = "No cloud-free Sentinel-2 scene found; showing SAR data only."
    elif sar_part is None:
        note = "No Sentinel-1 scene found for this year; showing optical data only."

    fields: dict = {"year": year, "is_gap_filled": not has_any_data, "note": note}
    if optical_part:
        fields.update(optical_part)
    if sar_part:
        fields.update(sar_part)

    return YearReading.model_validate(fields)


def _resolve_optical(bbox: BBox, year: int, lons: list[float], lats: list[float]) -> dict | None:
    if year < SENTINEL2_FIRST_USABLE_YEAR:
        return None
    date_from, date_to = _season_window(year)
    try:
        items = search_sentinel2(bbox, date_from, date_to, max_cloud_cover_pct=60, limit=10)
    except Exception:
        logger.exception("Sentinel-2 search failed for year %d", year)
        return None

    for item in items[:MAX_OPTICAL_SCENES_TO_TRY]:
        samples = sample_sentinel2_item(item, lons, lats)
        if not samples:
            continue
        indices = compute_optical_indices(samples)
        if not indices:
            continue
        return {
            "ndvi": round(indices.ndvi, 4) if indices.ndvi is not None else None,
            "ndwi": round(indices.ndwi, 4) if indices.ndwi is not None else None,
            "ndmi": round(indices.ndmi, 4) if indices.ndmi is not None else None,
            "nbr": round(indices.nbr, 4) if indices.nbr is not None else None,
            "evi": round(indices.evi, 4) if indices.evi is not None else None,
            "green_cover_pct": round(indices.green_cover_pct, 1),
            "water_cover_pct": round(indices.water_cover_pct, 1),
            "bare_soil_pct": round(indices.bare_soil_pct, 1),
            "optical_scene_id": item.id,
            "optical_scene_date": item.properties.get("datetime"),
            "cloud_cover_pct": item.properties.get("eo:cloud_cover"),
        }
    return None


def _resolve_sar(bbox: BBox, year: int, lons: list[float], lats: list[float]) -> dict | None:
    if year < SENTINEL1_FIRST_USABLE_YEAR:
        return None
    date_from, date_to = _season_window(year)
    try:
        items = search_sentinel1(bbox, date_from, date_to, limit=MAX_SAR_SCENES_TO_TRY)
    except Exception:
        logger.exception("Sentinel-1 search failed for year %d", year)
        return None

    for item in items[:MAX_SAR_SCENES_TO_TRY]:
        vv = sample_sentinel1_polarization(item, "vv", lons, lats)
        vh = sample_sentinel1_polarization(item, "vh", lons, lats)
        if vv is None and vh is None:
            continue

        vv_valid = [v for v in (vv or []) if v is not None]
        vh_valid = [v for v in (vh or []) if v is not None]
        if not vv_valid and not vh_valid:
            continue

        return {
            "sar_backscatter_vv_db": round(sum(vv_valid) / len(vv_valid), 2) if vv_valid else None,
            "sar_backscatter_vh_db": round(sum(vh_valid) / len(vh_valid), 2) if vh_valid else None,
            "sar_scene_id": item.id,
            "sar_scene_date": item.properties.get("datetime"),
        }
    return None


def available_year_range() -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    to_year = now.year if now.month >= 10 else now.year - 1
    # Start at the optical (Sentinel-2) floor rather than the SAR floor: the default
    # view is the optical "Vegetation" layer, and a shared x-axis that starts a year
    # before that layer can ever have data reads as a bug (a permanently empty first
    # data point). SAR's one extra year (2015) is still returned by _resolve_sar for
    # anyone who explicitly requests fromYear=2015, just not offered as the default.
    return SENTINEL2_FIRST_USABLE_YEAR, to_year
