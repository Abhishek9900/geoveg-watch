"""Pydantic models shared across the API surface."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class PolygonGeometry(BaseModel):
    """A GeoJSON Polygon: single outer ring, no holes (sufficient for this app's AOIs)."""

    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]

    @field_validator("coordinates")
    @classmethod
    def validate_ring(cls, value: list[list[list[float]]]) -> list[list[list[float]]]:
        if not value or len(value[0]) < 4:
            raise ValueError("Polygon must have an outer ring with at least 4 points (closed).")
        ring = value[0]
        for point in ring:
            if len(point) != 2:
                raise ValueError("Each coordinate must be a [lng, lat] pair.")
            lng, lat = point
            if not (-180 <= lng <= 180) or not (-90 <= lat <= 90):
                raise ValueError(f"Coordinate out of range: [{lng}, {lat}]")
        return value


class AreaHistoryRequest(BaseModel):
    polygon: PolygonGeometry
    from_year: int | None = Field(default=None, alias="fromYear")
    to_year: int | None = Field(default=None, alias="toYear")

    model_config = {"populate_by_name": True}


class YearReading(BaseModel):
    year: int
    ndvi: float | None = None
    ndwi: float | None = None
    ndmi: float | None = None
    nbr: float | None = None
    evi: float | None = None
    green_cover_pct: float | None = Field(default=None, alias="greenCoverPct")
    water_cover_pct: float | None = Field(default=None, alias="waterCoverPct")
    bare_soil_pct: float | None = Field(default=None, alias="bareSoilPct")
    sar_backscatter_vv_db: float | None = Field(default=None, alias="sarBackscatterVvDb")
    sar_backscatter_vh_db: float | None = Field(default=None, alias="sarBackscatterVhDb")
    optical_scene_id: str | None = Field(default=None, alias="opticalSceneId")
    optical_scene_date: str | None = Field(default=None, alias="opticalSceneDate")
    cloud_cover_pct: float | None = Field(default=None, alias="cloudCoverPct")
    sar_scene_id: str | None = Field(default=None, alias="sarSceneId")
    sar_scene_date: str | None = Field(default=None, alias="sarSceneDate")
    is_gap_filled: bool = Field(default=True, alias="isGapFilled")
    note: str | None = None

    model_config = {"populate_by_name": True}


class YearDelta(BaseModel):
    year: int
    green_cover_delta_pct: float | None = Field(default=None, alias="greenCoverDeltaPct")
    water_cover_delta_pct: float | None = Field(default=None, alias="waterCoverDeltaPct")
    classification: Literal["gain", "loss", "stable", "unknown"]

    model_config = {"populate_by_name": True}


class AreaInfo(BaseModel):
    polygon: PolygonGeometry
    area_hectares: float = Field(alias="areaHectares")
    centroid: list[float]

    model_config = {"populate_by_name": True}


class ResponseMeta(BaseModel):
    sampled_points: int = Field(alias="sampledPoints")
    optical_source: str = Field(alias="opticalSource")
    sar_source: str = Field(alias="sarSource")
    generated_at: str = Field(alias="generatedAt")

    model_config = {"populate_by_name": True}


class AvailableRange(BaseModel):
    from_: int = Field(alias="from")
    to: int

    model_config = {"populate_by_name": True}


class AreaHistoryResponse(BaseModel):
    area: AreaInfo
    available_range: AvailableRange = Field(alias="availableRange")
    years: list[YearReading]
    deltas: list[YearDelta]
    meta: ResponseMeta

    model_config = {"populate_by_name": True}


class GeocodeResultItem(BaseModel):
    display_name: str = Field(alias="displayName")
    lat: float
    lon: float
    bounding_box: list[float] | None = Field(default=None, alias="boundingBox")

    model_config = {"populate_by_name": True}


class GeocodeResponse(BaseModel):
    results: list[GeocodeResultItem]


class ErrorDetail(BaseModel):
    message: str
    code: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
