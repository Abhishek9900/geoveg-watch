"""
Sample Sentinel-2 L2A bands at specific lon/lat points and compute spectral indices.
Uses rasterio's windowed reads over signed Planetary Computer COG URLs (HTTPS, read via
GDAL's /vsicurl driver under the hood) so each request only pulls the small footprint
needed, not whole scenes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import rasterio
from pystac import Item
from rasterio.errors import RasterioIOError
from rasterio.warp import transform as warp_transform
from rasterio.windows import from_bounds

from app.services.geometry import BBox

logger = logging.getLogger(__name__)

# Scene Classification Layer codes to exclude (cloud, cloud shadow, snow, no-data, defective).
SCL_EXCLUDE = {0, 1, 3, 8, 9, 10}
SCL_WATER = 6

REQUIRED_OPTICAL_BANDS = ("B02", "B03", "B04", "B08", "B11", "B12", "SCL")


@dataclass
class OpticalSample:
    blue: float
    green: float
    red: float
    nir: float
    swir11: float
    swir12: float
    scl: int


def _read_band_at_points(
    href: str, lons: list[float], lats: list[float]
) -> tuple[np.ndarray, object]:
    """Open one COG band and sample it at the given WGS84 points, returning values + dataset CRS."""
    with rasterio.open(href) as ds:
        xs, ys = warp_transform("EPSG:4326", ds.crs, lons, lats)
        # A generous but bounded window covering all sample points, padded by a couple pixels.
        minx, maxx = min(xs), max(xs)
        miny, maxy = min(ys), max(ys)
        pad = max(ds.res) * 2
        window = from_bounds(minx - pad, miny - pad, maxx + pad, maxy + pad, transform=ds.transform)
        window = window.round_offsets().round_lengths()
        band = ds.read(1, window=window, boundless=True, fill_value=0)
        win_transform = ds.window_transform(window)

        values = np.empty(len(xs), dtype=np.float64)
        for i, (x, y) in enumerate(zip(xs, ys)):
            row, col = rasterio.transform.rowcol(win_transform, x, y)
            row = int(np.clip(row, 0, band.shape[0] - 1))
            col = int(np.clip(col, 0, band.shape[1] - 1))
            values[i] = band[row, col]
        return values, ds.crs


def sample_sentinel2_item(
    item: Item, lons: list[float], lats: list[float]
) -> list[OpticalSample] | None:
    """
    Read the bands needed for NDVI/NDWI/NDMI/NBR/EVI at the given points from one
    Sentinel-2 item. Returns None if required assets are missing or all reads fail.
    """
    missing = [b for b in REQUIRED_OPTICAL_BANDS if b not in item.assets]
    if missing:
        logger.warning("Sentinel-2 item %s missing assets: %s", item.id, missing)
        return None

    band_values: dict[str, np.ndarray] = {}
    try:
        for band in REQUIRED_OPTICAL_BANDS:
            href = item.assets[band].href
            values, _ = _read_band_at_points(href, lons, lats)
            band_values[band] = values
    except RasterioIOError as exc:
        logger.warning("Failed to read Sentinel-2 item %s: %s", item.id, exc)
        return None

    n = len(lons)
    samples: list[OpticalSample] = []
    for i in range(n):
        samples.append(
            OpticalSample(
                blue=float(band_values["B02"][i]),
                green=float(band_values["B03"][i]),
                red=float(band_values["B04"][i]),
                nir=float(band_values["B08"][i]),
                swir11=float(band_values["B11"][i]),
                swir12=float(band_values["B12"][i]),
                scl=int(band_values["SCL"][i]),
            )
        )
    return samples


@dataclass
class OpticalIndices:
    ndvi: float | None
    ndwi: float | None
    ndmi: float | None
    nbr: float | None
    evi: float | None
    green_cover_pct: float | None
    water_cover_pct: float | None
    bare_soil_pct: float | None
    valid_count: int
    total_count: int


GREEN_NDVI_THRESHOLD = 0.35
WATER_NDWI_THRESHOLD = 0.1
BARE_SOIL_NDVI_MAX = 0.15


def compute_optical_indices(samples: list[OpticalSample]) -> OpticalIndices | None:
    valid = [s for s in samples if s.scl not in SCL_EXCLUDE and not (s.red == 0 and s.nir == 0)]
    total = len(samples)
    if not valid:
        return None

    ndvis, ndwis, ndmis, nbrs, evis = [], [], [], [], []
    green_count = water_count = bare_count = 0

    for s in valid:
        red, nir, green, swir11, swir12, blue = s.red, s.nir, s.green, s.swir11, s.swir12, s.blue

        ndvi = (nir - red) / (nir + red) if (nir + red) else 0.0
        ndwi = (green - nir) / (green + nir) if (green + nir) else 0.0
        ndmi = (nir - swir11) / (nir + swir11) if (nir + swir11) else 0.0
        nbr = (nir - swir12) / (nir + swir12) if (nir + swir12) else 0.0
        # EVI uses reflectance values; Sentinel-2 L2A SR is scaled by 10000, EVI formula
        # is scale-invariant for the ratio terms since they're not divided by 10000 explicitly
        # — we normalize to 0..1 reflectance first for a standard-range EVI.
        r, n_, b = red / 10000.0, nir / 10000.0, blue / 10000.0
        evi_denom = n_ + 6 * r - 7.5 * b + 1
        evi = 2.5 * (n_ - r) / evi_denom if evi_denom else 0.0

        ndvis.append(ndvi)
        ndwis.append(ndwi)
        ndmis.append(ndmi)
        nbrs.append(nbr)
        evis.append(evi)

        if ndvi > GREEN_NDVI_THRESHOLD:
            green_count += 1
        if s.scl == SCL_WATER or ndwi > WATER_NDWI_THRESHOLD:
            water_count += 1
        if ndvi < BARE_SOIL_NDVI_MAX and ndwi <= WATER_NDWI_THRESHOLD:
            bare_count += 1

    n_valid = len(valid)
    return OpticalIndices(
        ndvi=float(np.mean(ndvis)),
        ndwi=float(np.mean(ndwis)),
        ndmi=float(np.mean(ndmis)),
        nbr=float(np.mean(nbrs)),
        evi=float(np.mean(evis)),
        green_cover_pct=(green_count / n_valid) * 100,
        water_cover_pct=(water_count / n_valid) * 100,
        bare_soil_pct=(bare_count / n_valid) * 100,
        valid_count=n_valid,
        total_count=total,
    )
