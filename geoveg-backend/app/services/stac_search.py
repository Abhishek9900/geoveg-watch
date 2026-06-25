"""
Search Microsoft Planetary Computer's STAC catalog for Sentinel-2 (optical) and
Sentinel-1 (SAR) scenes. No API key is required: `sign_inplace` calls Planetary
Computer's public SAS token endpoint automatically for every item/asset returned,
which is the officially documented, keyless way to get fetchable asset URLs.
"""

from __future__ import annotations

import logging

import planetary_computer
import pystac_client
from pystac import Item

from app.services.geometry import BBox, pad_bbox

logger = logging.getLogger(__name__)

STAC_API_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

_catalog: pystac_client.Client | None = None


def get_catalog() -> pystac_client.Client:
    """Lazily build a single shared catalog client signed for Planetary Computer access."""
    global _catalog
    if _catalog is None:
        _catalog = pystac_client.Client.open(
            STAC_API_URL,
            modifier=planetary_computer.sign_inplace,
        )
    return _catalog


def search_sentinel2(
    bbox: BBox,
    date_from: str,
    date_to: str,
    max_cloud_cover_pct: float = 60,
    limit: int = 10,
) -> list[Item]:
    catalog = get_catalog()
    padded = pad_bbox(bbox, margin_deg=0.005)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=list(padded),
        datetime=f"{date_from}/{date_to}",
        query={"eo:cloud_cover": {"lt": max_cloud_cover_pct}},
        sortby=[{"field": "properties.eo:cloud_cover", "direction": "asc"}],
        max_items=limit,
    )
    items = list(search.items())
    logger.info("sentinel-2 search %s..%s bbox=%s -> %d items", date_from, date_to, padded, len(items))
    return items


def search_sentinel1(
    bbox: BBox,
    date_from: str,
    date_to: str,
    limit: int = 5,
) -> list[Item]:
    """
    Sentinel-1 GRD has no cloud cover (radar penetrates clouds), so we just take
    the items closest to the middle of the search window for seasonal consistency.
    """
    catalog = get_catalog()
    padded = pad_bbox(bbox, margin_deg=0.005)
    search = catalog.search(
        collections=["sentinel-1-grd"],
        bbox=list(padded),
        datetime=f"{date_from}/{date_to}",
        max_items=limit,
    )
    items = list(search.items())
    logger.info("sentinel-1 search %s..%s bbox=%s -> %d items", date_from, date_to, padded, len(items))
    return items
