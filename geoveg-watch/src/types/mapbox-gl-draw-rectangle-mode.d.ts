declare module "mapbox-gl-draw-rectangle-mode" {
  // The package exports a MapboxDraw custom-mode object; no official types are
  // published. Modeling DrawCustomMode's exact shape isn't worth it for a single
  // untyped plugin, so this is intentionally `unknown` and cast at the call site.
  const DrawRectangle: unknown;
  export default DrawRectangle;
}
