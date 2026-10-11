// Shared view-zoom behaviour for the charts:
//   drag             → mark
//   Alt/Option+drag  → mark, then zoom to the marked part
//   Shift+drag       → pan
//   wheel / pinch    → zoom

export const ZOOM_HINT = "Drag to mark · Alt+drag to mark & zoom · Shift+drag to pan · scroll to zoom";

export const zoomFilter = (event) =>
  event.type === "wheel" || (event.type === "mousedown" && event.shiftKey && !event.button);

/** Brushes ignore Shift so Shift+drag pans instead of starting a brush.
 *  Use together with brush.keyModifiers(false), so Alt isn't taken by d3-brush. */
export const brushFilter = (event) => !event.ctrlKey && !event.button && !event.shiftKey;

/** Zoom transform with scale k that centres the base-coordinate point [cx, cy]
 *  in a [w, h] view, without panning past the chart's edges. */
export function centeredTransform([cx, cy], k, [w, h]) {
  const tx = Math.min(0, Math.max(w - w * k, w / 2 - k * cx));
  const ty = Math.min(0, Math.max(h - h * k, h / 2 - k * cy));
  return d3.zoomIdentity.translate(tx, ty).scale(k);
}

/** A "Reset zoom" button floating in the chart's corner, hidden until zoomed. */
export function zoomResetButton(area, onClick) {
  return area.append("button")
    .attr("type", "button")
    .attr("class", "zoom-reset")
    .attr("hidden", true)
    .attr("title", ZOOM_HINT)
    .text("Reset zoom")
    .on("click", onClick);
}

export const isZoomed = (t) => t.k !== 1 || t.x !== 0 || t.y !== 0;
