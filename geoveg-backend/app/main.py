from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.routers import area_history, geocode

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="GeoVeg Watch API", version="1.0.0")

_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Session-Id"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    message = first.get("msg", "Invalid request body.")
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "message": f"{field}: {message}" if field else message,
                "code": "VALIDATION_ERROR",
            }
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "message" in detail:
        body = {"error": detail}
    else:
        body = {"error": {"message": str(detail), "code": "ERROR"}}
    return JSONResponse(status_code=exc.status_code, content=body)


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error": {"message": str(exc), "code": "VALIDATION_ERROR"}},
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


app.include_router(area_history.router)
app.include_router(geocode.router)
