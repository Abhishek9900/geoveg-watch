"""
Sample Sentinel-1 GRD amplitude bands and apply radiometric calibration to produce
genuine sigma-nought backscatter in dB, rather than raw uncalibrated digital numbers.
"""

from __future__ import annotations

import logging

import numpy as np
import rasterio
import requests
from pystac import Item
from pystac.errors import ExtensionNotImplemented
from pystac.extensions.projection import ProjectionExtension
from rasterio.crs import CRS
from rasterio.errors import CRSError, RasterioIOError
from rasterio.transform import from_gcps
from rasterio.warp import transform as warp_transform

from app.services.sar_calibration import dn_to_sigma0_db, parse_calibration_lut

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 20


def _fetch_calibration_lut(href: str):
    response = requests.get(href, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    return parse_calibration_lut(response.content)


def _crs_from_item(item: Item) -> CRS | None:
    """
    Try to get a CRS from the STAC item's Projection Extension metadata,
    without opening the raster. Checks `code` (e.g. "EPSG:4326", the current
    proj extension v2 field), then falls back to the older `epsg` and `wkt2`
    fields for items written against older extension versions.

    Returns None if the extension isn't present, carries no CRS info, or
    carries a malformed value (e.g. some Planetary Computer items have been
    seen with proj:code == "EPSG:None" -- see
    https://github.com/microsoft/PlanetaryComputer/issues/414). This is also
    the normal, expected case for raw Sentinel-1 GRD items, which are
    GCP-georeferenced and have no single scene-wide CRS to publish.
    """
    try:
        proj = ProjectionExtension.ext(item)
    except ExtensionNotImplemented:
        # Expected, normal case for raw Sentinel-1 GRD items: they are
        # GCP-georeferenced and have no single scene-wide CRS to publish,
        # so they legitimately don't implement the projection extension.
        # pystac documents this as the exception raised by `.ext()` when
        # an object doesn't implement the requested extension, so catch
        # it specifically rather than masking unrelated bugs with a bare
        # `except Exception`.
        return None

    code = getattr(proj, "code", None)
    epsg = getattr(proj, "epsg", None)
    wkt2 = getattr(proj, "wkt2", None)

    candidates = []
    if code is not None:
        candidates.append(("code", code))
    if epsg is not None:
        candidates.append(("epsg", f"EPSG:{epsg}"))
    if wkt2 is not None:
        candidates.append(("wkt2", wkt2))

    for source_name, value in candidates:
        try:
            if source_name == "wkt2":
                return CRS.from_wkt(value)
            return CRS.from_string(value)
        except CRSError as exc:
            logger.warning(
                "Item %s has unusable proj:%s value %r: %s", item.id, source_name, value, exc
            )
            continue

    return None


def _rows_cols_from_lonlat(
    item: Item, ds: rasterio.DatasetReader, lons: list[float], lats: list[float]
) -> list[tuple[float, float]]:
    """
    Map WGS84 (lon, lat) points to (row, col) pixel coordinates in `ds`.

    Tries the following sources for the dataset's CRS, in order of preference:
    1. The STAC item's Projection Extension (proj:code, falling back to proj:epsg / proj:wkt2), if present.
    2. The raster's own embedded CRS (`ds.crs`).
    3. Ground Control Points (`ds.gcps`), fitting an approximate affine, using
       the GCPs' own reported CRS if available.
    4. If GCPs exist but report no CRS of their own, or there are no GCPs at
       all: fall back to EPSG:4326. Per ESA/Copernicus documentation, raw
       Sentinel-1 GRD products are processed in their native state directly
       against the WGS84 ellipsoid (EPSG:4326), so this is a safe default
       for this collection rather than an arbitrary guess.

    This avoids raising specifically for the "GCPs exist but report no CRS"
    case, using the EPSG:4326 default documented for raw Sentinel-1 GRD
    products. It still raises RasterioIOError if there are no GCPs and no
    CRS at all, since there is nothing principled to fall back to in that
    case; the caller (sample_sentinel1_polarization) catches this and
    returns None.
    """
    crs = _crs_from_item(item) or ds.crs
    if crs is not None:
        xs, ys = warp_transform("EPSG:4326", crs, lons, lats)
        return [ds.index(x, y) for x, y in zip(xs, ys)]

    gcps, gcp_crs = ds.gcps
    if not gcps:
        # No CRS, no transform, and no GCPs: there is no information in this
        # dataset linking pixels to geographic coordinates, so there is no
        # reasonable default to assume here (unlike the GCP-CRS-missing case
        # below, where Sentinel-1's documented native WGS84 processing gives
        # us a principled fallback). Surface this as a read failure so it's
        # caught and logged by the caller instead of silently sampling the
        # wrong pixels.
        raise RasterioIOError(
            f"Dataset {ds.name} has no CRS (item proj extension or ds.crs) "
            "and no GCPs to georeference it"
        )

    if gcp_crs is None:
        logger.info(
            "Dataset %s has GCPs with no reported CRS; assuming native "
            "Sentinel-1 WGS84 (EPSG:4326) geometry for the GCPs",
            ds.name,
        )
        gcp_crs = "EPSG:4326"

    xs, ys = warp_transform("EPSG:4326", gcp_crs, lons, lats)
    approx_transform = from_gcps(gcps)
    inv_transform = ~approx_transform
    # Affine application returns (col, row); flip to the (row, col) order
    # used elsewhere in this module.
    return [(row, col) for col, row in (inv_transform * (x, y) for x, y in zip(xs, ys))]


def sample_sentinel1_polarization(
    item: Item, polarization: str, lons: list[float], lats: list[float]
) -> list[float] | None:
    """
    Returns calibrated sigma-nought (dB) values at each point for one polarization
    ("vv" or "vh"), or None if the required assets are missing or unreadable.
    """
    if polarization not in item.assets or f"schema-calibration-{polarization}" not in item.assets:
        logger.warning("Sentinel-1 item %s missing %s band or calibration schema", item.id, polarization)
        return None

    try:
        lut = _fetch_calibration_lut(item.assets[f"schema-calibration-{polarization}"].href)
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Failed to fetch/parse calibration LUT for %s: %s", item.id, exc)
        return None

    try:
        with rasterio.open(item.assets[polarization].href) as ds:
            rows_cols = _rows_cols_from_lonlat(item, ds, lons, lats)
            rows = [int(np.clip(r, 0, ds.height - 1)) for r, _ in rows_cols]
            cols = [int(np.clip(c, 0, ds.width - 1)) for _, c in rows_cols]

            min_row, max_row = min(rows), max(rows)
            min_col, max_col = min(cols), max(cols)
            window = rasterio.windows.Window(
                col_off=min_col,
                row_off=min_row,
                width=(max_col - min_col + 1),
                height=(max_row - min_row + 1),
            )
            band = ds.read(1, window=window, boundless=True, fill_value=0)

            dns = np.empty(len(rows), dtype=np.float64)
            calib_constants = np.empty(len(rows), dtype=np.float64)
            for i, (row, col) in enumerate(zip(rows, cols)):
                local_row = row - min_row
                local_col = col - min_col
                dns[i] = band[local_row, local_col]
                calib_constants[i] = lut.value_at(line=row, pixel=col)
    except RasterioIOError as exc:
        logger.warning("Failed to read Sentinel-1 item %s band %s: %s", item.id, polarization, exc)
        return None

    sigma0_db = dn_to_sigma0_db(dns, calib_constants)
    return [float(v) if np.isfinite(v) else None for v in sigma0_db]