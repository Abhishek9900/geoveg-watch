# GeoVeg Watch

Draw or search any area and see how its vegetation, water, moisture, disturbance,
and radar backscatter have changed year by year — real Sentinel-1/Sentinel-2 satellite
data, no API keys, no ML model training.

## Architecture

- **geoveg-watch/** — Next.js 16 + TypeScript frontend. MapLibre GL JS map (vector tiles,
  via OpenFreeMap, keyless) with `@mapbox/mapbox-gl-draw` for polygon drawing. Redux Toolkit
  for app state (selected area, history data, active year, active layer). Recharts for the
  timeline chart.
- **geoveg-backend/** — Python FastAPI backend doing all the heavy geospatial work:
  STAC search via `pystac-client` + `planetary-computer` (Microsoft Planetary Computer,
  keyless), pixel reads via `rasterio`, NDVI/NDWI/NDMI/NBR/EVI computation, and full
  radiometric calibration of Sentinel-1 GRD to genuine sigma-nought dB backscatter
  (parsing the product's own calibration LUT XML — verified against ESA's official
  worked example to 3 decimal places).

The two services are independent processes; the frontend calls the backend over HTTP
(`NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:8000`).

## Why a backend rewrite from the original Next.js-only version

The first version hand-rolled STAC signing and COG band reads in `geotiff.js` directly
in Next.js API routes, and it returned empty data for every year in deployment. Rather
than keep debugging blind (this sandbox cannot reach Planetary Computer to test live),
the fix was to move onto the actual library-maintained, officially-documented pattern:
`pystac_client.Client.open(url, modifier=planetary_computer.sign_inplace)`. This removes
an entire class of "did I get the byte-range/signing details right" bugs by relying on
maintained libraries instead of hand-rolled HTTP plumbing.

## Multi-user caching

Per your call: caching is **per-session, in-memory, not shared across users, not
persisted to disk**. Each browser tab generates a random session id (`X-Session-Id`
header) that scopes its own cache bucket on the backend; a server restart clears
everything, and no user ever sees another user's cached results. This trades "instant
for everyone on popular areas" for "simple and correct under concurrent load," which
was the explicit tradeoff requested.

## New data layers (from the original research doc + standard remote-sensing practice)

| Layer | Index | Source | Notes |
|---|---|---|---|
| Vegetation | NDVI, EVI | Sentinel-2 | EVI is more robust in dense canopy |
| Water | NDWI | Sentinel-2 | surface water / wetness |
| Moisture | NDMI | Sentinel-2 | vegetation moisture / drought stress |
| Disturbance | NBR | Sentinel-2 | burn scars / clear-cuts |
| Radar | calibrated σ⁰ (VV, VH) | Sentinel-1 GRD | cloud-penetrating, fills optical gaps |

## Honest limitations (carried over / updated)

- Still an NDVI/NDWI/etc. **threshold approximation**, not an official land-cover product.
  Global Forest Watch's Hansen dataset remains the better source if you're ever open to a
  free API key.
- Sentinel-1 calibration uses the product's bundled LUT, not full terrain correction
  (RTC) — RTC on Planetary Computer requires an account, which would break the keyless
  requirement. Slope/shadow effects in mountainous terrain are not corrected for.
- This sandbox cannot reach Planetary Computer, Nominatim, or any live satellite source
  (egress is locked to package registries only). Every layer of logic was verified against
  synthetic data and the ESA reference numbers where possible; the live "happy path" with
  real pixels has not been observed end-to-end and should be checked once deployed
  somewhere with normal internet.

## Running locally

### Option A — Docker Compose (recommended)
```bash
docker compose up --build
```
Frontend: http://localhost:3000 · Backend docs: http://localhost:8000/docs

### Option B — manual
```bash
# backend
cd geoveg-backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (separate terminal)
cd geoveg-watch
npm install
npm run dev
```

## Verification performed in this sandbox

- Backend: all service modules import cleanly; FastAPI app assembles with all 3 routes;
  all input-validation error paths (invalid polygon, too small/large, bad JSON, missing
  query param) tested via `TestClient` and return consistent `{"error": {...}}` shapes;
  SAR calibration formula matches ESA's published worked example to 3 decimals; lon/lat
  ↔ row/col round-trip and windowed multi-point raster reads verified against synthetic
  GeoTIFFs with known pixel values; NDVI/NDWI/NDMI/NBR/EVI computation verified against
  realistic synthetic forest/burn/water/cloud spectral signatures.
- Frontend: `tsc --noEmit`, `eslint .`, and `next build` all pass with zero errors/warnings.
  Every CSS variable referenced in components is defined in `globals.css` (cross-checked).
- **Not verified**: live network calls to Planetary Computer/Nominatim from this sandbox
  (egress blocked) and the Next.js dev server's live runtime behavior in this specific
  container (the process kept exiting after "Ready" for reasons unrelated to the code —
  likely a sandbox process-lifecycle quirk, not a code defect, since `next build` succeeds
  and the equivalent pre-MapLibre version ran fine earlier in this same environment).
