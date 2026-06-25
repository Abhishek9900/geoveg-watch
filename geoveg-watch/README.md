# GeoVeg Watch

Draw or search any area on the map and see how its green cover (vegetation/forest) and
water/moisture cover have changed, year by year, using **real Sentinel-2 satellite data** —
no API keys, no account sign-up, no model training.

## How it works

1. **Pick an area.** Draw a polygon/rectangle on the map, or search a place name (geocoded via
   OpenStreetMap Nominatim).
2. **Backend computes a year-by-year reading.** For each year from 2015 (Sentinel-2's practical
   start) to last year, the server:
   - Searches the **Microsoft Planetary Computer STAC API** (public, keyless) for the
     least-cloudy Sentinel-2 L2A scene over your area in that year's Apr–Oct window.
   - Reads the actual pixel bands it needs (Red, NIR, Green, Scene Classification Layer)
     directly from the public Cloud-Optimized GeoTIFFs using HTTP range requests
     (via `geotiff.js` — no GDAL, no Python, no whole-file downloads).
   - Computes **NDVI** (vegetation index) and **NDWI** (water index) at ~36 sample points
     spread across your polygon, masking out cloud/shadow/no-data pixels using the SCL band.
   - Classifies each sample point as "green cover" (NDVI above a threshold) or
     "water/moisture" and aggregates to a percentage for that year.
3. **Results are cached** to disk (`.cache/area-years`) so re-visiting the same area is instant
   after the first computation.
4. **Frontend renders a timeline.** Scrub or auto-play through the years; the chart and the
   map polygon's own color both update to reflect that year's green-cover percentage.

## Why this approach (and not GFW / Sentinel Hub / ML)

- **Global Forest Watch's Data API** has the cleanest "tree cover loss by polygon" data, but
  its query endpoint requires a free account + API key. Per your instruction to stay fully
  keyless, this app does not use it. If you're open to signing up for a free GFW key later,
  swapping it in for higher-confidence forest-loss numbers would be the natural upgrade path —
  ask and I can wire it in.
- **Sentinel Hub Statistical API** (Copernicus Data Space) is excellent for this exact use case
  but requires an OAuth account.
- **Microsoft Planetary Computer** is the one major Earth-observation platform that is
  genuinely public and keyless for both search (STAC) and data access (signed COG URLs), so
  it's what this app is built on.
- No ML model is trained or used. "Green cover %" and "water cover %" are simple, transparent
  threshold rules on NDVI/NDWI — not a land-cover classifier. This is explicitly the "bare
  minimum, no training" approach you asked for.

## Honest limitations

- **This is an approximation, not an official deforestation product.** NDVI threshold
  classification will misclassify some agricultural land, scrub, and seasonal variation as
  "green cover." For rigorous forest-loss analysis, Global Forest Watch's Hansen/UMD dataset
  (with a free API key) is the better source — happy to add it as a second data layer later.
- **Cloud cover gaps.** Some years/areas may have no sufficiently clear Sentinel-2 scene in the
  search window; those years show as "no cloud-free scene found" rather than a guessed value.
  The app does not fabricate data for missing years.
- **Live computation, not instant.** Each year requires actually reading satellite imagery, so
  loading a fresh area's full history can take a noticeable amount of time on first run
  (subsequent loads of the same area are instant via cache).
- **Area size cap (~20,000 ha).** Kept deliberately modest because this app samples live
  raster windows per request rather than relying on precomputed global tiles.
- **Sentinel-2 history starts in 2015**, so that's the earliest year offered regardless of the
  area selected.
- **This sandbox build environment has no internet access** to Planetary Computer, Nominatim,
  or any satellite data source — only npm/PyPI package registries. The error-handling paths
  (invalid input, missing scenes, network failures) were verified directly; the "happy path"
  with real pixel data has **not** been verified end-to-end and should be checked once deployed
  somewhere with normal internet access. If anything doesn't behave as expected there, the most
  likely places to look are `src/lib/stac-client.ts` (STAC query shape) and
  `src/lib/raster-indices.ts` (band sampling/index math).

## Project structure

```
src/
  app/
    api/area-history/route.ts   # main endpoint: polygon -> year-by-year readings
    api/geocode/route.ts        # place name -> lat/lon + bounding box
    page.tsx                    # main UI layout
  components/
    AreaMap.tsx                 # Leaflet map, draw tools, search box
    AreaSelectionPanel.tsx      # pre-load summary + "Load satellite history" button
    TimelinePanel.tsx           # year scrubber, play/pause, chart, stat cards
  lib/
    geometry.ts                 # polygon area/bbox/sampling math (pure functions)
    stac-client.ts              # Planetary Computer STAC search + asset signing
    raster-indices.ts           # COG band reading + NDVI/NDWI computation
    year-resolver.ts            # per-year orchestration with scene fallback
    cache.ts                    # disk cache for computed years
  types/index.ts                # shared types
```

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. Draw an area, click **Load satellite history**, and wait for the
first run (subsequent loads of the same polygon are cached).

## Linting & type-checking

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

All three currently pass with zero errors and zero warnings.

## Natural next steps (not built yet, by design — "bare minimum" first)

- Optional GFW API key integration for authoritative tree-cover-loss numbers alongside NDVI.
- A second chart series for soil moisture (NASA POWER, also keyless) if useful.
- Persisting cache in a real database instead of flat JSON files for multi-instance deployments.
- WebSocket/SSE streaming of per-year progress instead of an elapsed-time estimate, since
  the current single-request design has no way to report true incremental progress.
