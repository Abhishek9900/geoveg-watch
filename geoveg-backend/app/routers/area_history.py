from __future__ import annotations

import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException

from app.models.schemas import (
    AreaHistoryRequest,
    AreaHistoryResponse,
    AreaInfo,
    AvailableRange,
    ResponseMeta,
    YearDelta,
    YearReading,
)
from app.services.geometry import generate_sample_points, prepare_area
from app.services.session_cache import get_cached, set_cached
from app.services.year_resolver import available_year_range, resolve_year_reading

logger = logging.getLogger(__name__)
router = APIRouter()

MIN_AREA_HECTARES = 0.5
MAX_AREA_HECTARES = 50_000  # ~500 km^2; raised from the prior single-service version
SAMPLE_TARGET_POINTS = 36
YEAR_FETCH_CONCURRENCY = 4


@router.post("/api/area-history", response_model=AreaHistoryResponse)
def get_area_history(
    request: AreaHistoryRequest,
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
) -> AreaHistoryResponse:
    session_id = x_session_id or "anonymous"

    prepared = prepare_area(request.polygon.model_dump())

    if prepared.area_hectares < MIN_AREA_HECTARES:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Selected area is too small ({prepared.area_hectares:.2f} ha). Draw a larger area.",
                "code": "AREA_TOO_SMALL",
            },
        )
    if prepared.area_hectares > MAX_AREA_HECTARES:
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    f"Selected area is too large ({prepared.area_hectares:,.0f} ha). "
                    f"Please select an area under {MAX_AREA_HECTARES:,} ha."
                ),
                "code": "AREA_TOO_LARGE",
            },
        )

    default_from, default_to = available_year_range()
    from_year = _clamp(request.from_year or default_from, default_from, default_to)
    to_year = _clamp(request.to_year or default_to, default_from, default_to)
    if from_year > to_year:
        raise HTTPException(
            status_code=400,
            detail={"message": "fromYear must be <= toYear.", "code": "INVALID_RANGE"},
        )

    sample_points = generate_sample_points(prepared.polygon, SAMPLE_TARGET_POINTS)
    lons = [p[0] for p in sample_points]
    lats = [p[1] for p in sample_points]
    polygon_key = hashlib.sha1(json.dumps(request.polygon.model_dump()).encode()).hexdigest()[:16]

    years = list(range(from_year, to_year + 1))
    readings: dict[int, YearReading] = {}

    def fetch_year(year: int) -> tuple[int, YearReading]:
        cache_key = f"{polygon_key}:{year}"
        cached = get_cached(session_id, cache_key)
        if cached is not None:
            return year, cached
        reading = resolve_year_reading(prepared.bbox, year, lons, lats)
        set_cached(session_id, cache_key, reading)
        return year, reading

    with ThreadPoolExecutor(max_workers=YEAR_FETCH_CONCURRENCY) as pool:
        futures = [pool.submit(fetch_year, year) for year in years]
        for future in as_completed(futures):
            year, reading = future.result()
            readings[year] = reading

    ordered_readings = [readings[y] for y in years]
    deltas = _compute_deltas(ordered_readings)

    return AreaHistoryResponse(
        area=AreaInfo(
            polygon=request.polygon,
            area_hectares=round(prepared.area_hectares, 2),
            centroid=list(prepared.centroid),
        ),
        available_range=AvailableRange(**{"from": from_year, "to": to_year}),
        years=ordered_readings,
        deltas=deltas,
        meta=ResponseMeta(
            sampled_points=len(sample_points),
            optical_source="Sentinel-2 L2A via Microsoft Planetary Computer (keyless public STAC catalog)",
            sar_source=(
                "Sentinel-1 GRD via Microsoft Planetary Computer, calibrated to sigma-nought dB "
                "using the product's own calibration LUT (ESA-EOPG-CSCOP-TN-0002)"
            ),
            generated_at=datetime.now(timezone.utc).isoformat(),
        ),
    )


def _compute_deltas(years: list[YearReading]) -> list[YearDelta]:
    deltas: list[YearDelta] = []
    for prev, curr in zip(years, years[1:]):
        if prev.green_cover_pct is None or curr.green_cover_pct is None:
            deltas.append(
                YearDelta(year=curr.year, green_cover_delta_pct=None, water_cover_delta_pct=None, classification="unknown")
            )
            continue
        green_delta = round(curr.green_cover_pct - prev.green_cover_pct, 1)
        water_delta = (
            round(curr.water_cover_pct - prev.water_cover_pct, 1)
            if prev.water_cover_pct is not None and curr.water_cover_pct is not None
            else None
        )
        classification = "stable"
        if green_delta > 2:
            classification = "gain"
        elif green_delta < -2:
            classification = "loss"
        deltas.append(
            YearDelta(
                year=curr.year,
                green_cover_delta_pct=green_delta,
                water_cover_delta_pct=water_delta,
                classification=classification,
            )
        )
    return deltas


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))
