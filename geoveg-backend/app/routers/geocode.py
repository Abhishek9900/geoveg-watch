from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import GeocodeResponse, GeocodeResultItem

logger = logging.getLogger(__name__)
router = APIRouter()

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


@router.get("/api/geocode", response_model=GeocodeResponse)
async def geocode(q: str = Query(..., min_length=1)) -> GeocodeResponse:
    params = {"q": q, "format": "json", "limit": "5"}
    headers = {"User-Agent": "GeoVegWatch/1.0 (environmental monitoring app)"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(NOMINATIM_URL, params=params, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={"message": f"Geocoding service unreachable: {exc}", "code": "GEOCODE_UNREACHABLE"},
        ) from exc

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail={"message": "Geocoding request failed.", "code": "GEOCODE_FAILED"},
        )

    raw = response.json()
    results = [
        GeocodeResultItem(
            display_name=item["display_name"],
            lat=float(item["lat"]),
            lon=float(item["lon"]),
            bounding_box=(
                [
                    float(item["boundingbox"][2]),
                    float(item["boundingbox"][0]),
                    float(item["boundingbox"][3]),
                    float(item["boundingbox"][1]),
                ]
                if item.get("boundingbox")
                else None
            ),
        )
        for item in raw
    ]
    return GeocodeResponse(results=results)
