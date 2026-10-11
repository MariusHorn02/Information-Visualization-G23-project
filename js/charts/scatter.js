import { ATTRIBUTES, attrLabel, correlation } from "../data.js";
import { COLOR_ENCODINGS, colorScale, transitionMs, dotRadius } from "../theme.js";
import { isActive, hasFilter, inPeriod } from "../state.js";
import { renderLegend, markLegend, legendSelector } from "../legend.js";
import * as tooltip from "../tooltip.js";
import { zoomFilter, brushFilter, zoomResetButton, isZoomed, centeredTransform } from "../zoom.js";

const NAME = "scatter";
const MAX_ZOOM = 20;
const MARGIN = { top: 10, right: 18, bottom: 42, left: 70 };
const HOVER_RADIUS = 14;
const JITTER = 5;        
const CHANNELS = ["x", "y", "color"];

// Only the options the tasks need; the calendar keeps its own colour modes.
const X_OPTIONS = ["rain_mm", "temp_c", "traffic_count"];
const Y_OPTIONS = ["bike_trips", "traffic_count", "no2_ug_m3", "bike_avg_duration_min"];
const COLOR_OPTIONS = ["season", "day_type", "rain_category", "year"];

const finite = Number.isFinite;
const fmtR = d3.format("+.2f");


function jitterOf(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

export function create(container, data, dispatcher) {
  const root = d3.select(container);

  const controls = root.append("div").attr("class", "controls");
  const selects = {
    x: addSelect("x", "X", X_OPTIONS, attrLabel),
    y: addSelect("y", "Y", Y_OPTIONS, attrLabel),
    color: addSelect("color", "Category", COLOR_OPTIONS, (k) => COLOR_ENCODINGS[k].label),
  };

  /** Show the current encoding, and never allow X = Y. */
  function syncControls(wanted) {
    for (const c of CHANNELS) selects[c].property("value", wanted[c]);
    selects.x.selectAll("option").property("disabled", (k) => k === wanted.y);
    selects.y.selectAll("option").property("disabled", (k) => k === wanted.x);
  }

  const area = root.append("div").attr("class", "chart-area");
  const svg = area.append("svg").attr("role", "img");
  const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  const gridX = g.append("g").attr("class", "grid");
  const gridY = g.append("g").attr("class", "grid");
  const axisX = g.append("g").attr("class", "axis axis--x");
  const axisY = g.append("g").attr("class", "axis axis--y");
  const labelX = g.append("text").attr("class", "axis-label").attr("text-anchor", "middle");
  const labelY = g.append("text").attr("class", "axis-label").attr("text-anchor", "middle")
    .attr("transform", "rotate(-90)");
  const clipRect = svg.append("defs").append("clipPath").attr("id", "sc-plot-clip").append("rect");
  const dotsG = g.append("g").attr("class", "dots").attr("clip-path", "url(#sc-plot-clip)");

  const brushG = g.append("g").attr("class", "brush");
  const resetZoomBtn = zoomResetButton(area, () => g.call(zoom.transform, d3.zoomIdentity));

  const note = root.append("div").attr("class", "chart-note");
  const legend = root.append("div").attr("class", "legend");

  let width = 0;
  let height = 0;
  let enc = null;         
  let points = [];    
  let x0, y0;             // scales for the full data extent
  let x, y, color, delaunay; // x0/y0 rescaled by the current zoom
  let periodKey = null;  
  let last = null;
  const legendSel = legendSelector(dispatcher, `${NAME}:legend`, () => data,
    () => COLOR_ENCODINGS[enc.color].field);

  const offset = (key, d) => (ATTRIBUTES[key].jitterZero && d[key] === 0 ? jitterOf(d.id) * JITTER : 0);
  const px = (d) => x(d[enc.x]) + offset(enc.x, d);
  const py = (d) => y(d[enc.y]) - offset(enc.y, d);

  const zoom = d3.zoom()
    .scaleExtent([1, MAX_ZOOM])
    .filter(zoomFilter)
    .on("zoom", zoomed);
  g.call(zoom).on("dblclick.zoom", null);

  let brushRect = null;   // marked rectangle in data units, so it follows the zoom
  let altZoom = false;    // this brush was started with Alt: zoom to it on release

  const brush = d3.brush()
    .filter(brushFilter)
    .keyModifiers(false)
    .on("start", (event) => {
      if (!event.sourceEvent) return;
      altZoom = event.sourceEvent.altKey;
      tooltip.hide();
      dispatcher.call("hover", null, null);
    })
    .on("brush end", brushed);

  function addSelect(channel, label, keys, format) {
    const wrap = controls.append("label");
    wrap.append("span").text(`${label}:`);
    return wrap.append("select")
      .attr("aria-label", `${label} attribute`)
      .on("change", (event) => dispatcher.call("encode", null, { chart: NAME, [channel]: event.target.value }))
      .call((s) => s.selectAll("option").data(keys).join("option").attr("value", (d) => d).text(format));
  }

  function makeScale(key, [r0, r1]) {
    const pad = ATTRIBUTES[key].jitterZero ? JITTER + 1 : 0;
    const dir = r1 > r0 ? 1 : -1;
    return d3.scaleLinear()
      .domain(d3.extent(points, (d) => d[key]))
      .range([r0 + dir * pad, r1])
      .nice();
  }

  function render(state, animate) {
    enc = { ...state.encodings.scatter };
    points = data.filter((d) => finite(d[enc.x]) && finite(d[enc.y]));

    x = x0 = makeScale(enc.x, [0, width]);
    y = y0 = makeScale(enc.y, [height, 0]);
    color = colorScale(enc.color, data);

    // New axes or a new size: start from the full view again. Setting __zoom
    // directly resets the zoom state without firing a "zoom" event.
    const extent = [[0, 0], [width, height]];
    zoom.extent(extent).translateExtent(extent);
    g.property("__zoom", d3.zoomIdentity);
    resetZoomBtn.attr("hidden", true);
    clipRect.attr("width", width).attr("height", height);

    const t = animate
      ? svg.transition("encode").duration(transitionMs()).ease(d3.easeCubicInOut)
      : null;
    const T = (sel) => (t ? sel.transition(t) : sel.interrupt());

    svg.attr("aria-label", `Scatterplot of ${attrLabel(enc.y)} against ${attrLabel(enc.x)}, coloured by ${COLOR_ENCODINGS[enc.color].label}`);

    renderAxes(T);

    labelX.attr("x", width / 2).attr("y", height + 36).text(attrLabel(enc.x));
    labelY.attr("x", -height / 2).attr("y", -56).text(attrLabel(enc.y));

    const r = dotRadius();
    const fill = (d) => color(d[COLOR_ENCODINGS[enc.color].field]);
    const stroke = (d) => d3.color(fill(d))?.darker(0.8) ?? null;

    dotsG.selectAll("circle")
      .data(points, (d) => d.id)
      .join(
        (enter) => enter.append("circle")
          .attr("class", "dot")
          .attr("cx", px).attr("cy", py)
          .attr("r", animate ? 0 : r)
          .attr("fill", fill).attr("stroke", stroke),
        (update) => update,
        (exit) => exit.call((s) => (t ? s.transition(t).attr("r", 0).remove() : s.remove())),
      )
      .call((s) => T(s).attr("cx", px).attr("cy", py).attr("r", r).attr("fill", fill).attr("stroke", stroke));

    delaunay = d3.Delaunay.from(points, px, py);

    brush.extent([[0, 0], [width, height]]);
    brushG.call(brush);
    brushG.call(brush.move, null);
    brushRect = null;

    const hidden = data.length - points.length;
    note.text(hidden ? `${hidden} day${hidden > 1 ? "s" : ""} not shown (missing ${[enc.x, enc.y]
      .filter((k) => data.some((d) => !finite(d[k]))).map((k) => ATTRIBUTES[k].label).join(" / ")} value)` : "");

    renderCorrelationLegend(state);
  }

  function renderAxes(T) {
    const xTicks = Math.max(2, Math.floor(width / 80));
    const yTicks = Math.max(2, Math.floor(height / 50));
    T(axisX.attr("transform", `translate(0,${height})`)).call(d3.axisBottom(x).ticks(xTicks));
    T(axisY).call(d3.axisLeft(y).ticks(yTicks));
    T(gridX).call(d3.axisBottom(x).ticks(xTicks).tickSize(height).tickFormat(""));
    T(gridY).call(d3.axisLeft(y).ticks(yTicks).tickSize(-width).tickFormat(""));
  }

  function zoomed(event) {
    if (!x0) return;
    x = event.transform.rescaleX(x0);
    y = event.transform.rescaleY(y0);
    renderAxes((sel) => sel.interrupt());
    const r = dotRadius();
    dotsG.selectAll("circle").interrupt()
      .attr("cx", px).attr("cy", py)
      .attr("r", (d) => (d.id === last?.hoveredId ? r * 2 : r));
    delaunay = d3.Delaunay.from(points, px, py);
    syncBrush();
    resetZoomBtn.attr("hidden", isZoomed(event.transform) ? null : true);
  }

  /** Redraw the marked rectangle at its data position in the current view. */
  function syncBrush() {
    if (!brushRect || last?.selectionSource !== NAME) return brushG.call(brush.move, null);
    const cx = (v) => Math.max(0, Math.min(width, x(v)));
    const cy = (v) => Math.max(0, Math.min(height, y(v)));
    const [[a, b], [c, d]] = brushRect;
    const sel = [[cx(a), cy(b)], [cx(c), cy(d)]];
    brushG.call(brush.move, sel[1][0] > sel[0][0] && sel[1][1] > sel[0][1] ? sel : null);
  }

  /** Zoom so the pixel rectangle [[x0, y0], [x1, y1]] fills the plot. */
  function zoomToRect([[x0, y0], [x1, y1]]) {
    const t = d3.zoomTransform(g.node());
    const fit = Math.min(width / Math.max(1, x1 - x0), height / Math.max(1, y1 - y0));
    const k = Math.max(1, Math.min(MAX_ZOOM, t.k * fit));
    const center = [t.invertX((x0 + x1) / 2), t.invertY((y0 + y1) / 2)];
    g.transition().duration(transitionMs()).ease(d3.easeCubicInOut)
      .call(zoom.transform, centeredTransform(center, k, [width, height]));
  }

  function renderCorrelationLegend(state) {
    const ce = COLOR_ENCODINGS[enc.color];
    const inScope = points.filter((d) => inPeriod(state, d));
    periodKey = key(state);
    const r = (pts) => correlation(pts, enc.x, enc.y);
    const rOf = new Map(ce.type === "sequential" ? []
      : ce.domain.map((v) => [v, r(inScope.filter((d) => d[ce.field] === v))]));

    renderLegend(legend, enc.color, color, {
      counts: d3.rollup(inScope, (v) => v.length, (d) => d[ce.field]),
      showCounts: true,
      onSelect: (v) => legendSel.select(v, last),
      // Always present (r = – when a group has too few days), so items keep their width.
      extra: (v) => `r = ${rOf.get(v) != null ? fmtR(rOf.get(v)) : "–"}`,
    });
    const overall = r(inScope);
    const note = legend.append("span").attr("class", "legend__note")
      .attr("title", "Pearson correlation between X and Y: −1 perfect negative, 0 none, +1 perfect positive");
    note.append("span").text(ce.type === "sequential" ? "correlation r = " : "r = correlation of X and Y per group · all: ");
    note.append("span").attr("class", "legend__num").text(overall == null ? "–" : fmtR(overall));
    markLegend(legend, legendSel.active(state));
  }

  const key = (s) => `${s.zoom?.map(Number)}|${s.timeRange?.map(Number)}`;

  function applySelection(state) {
    const filtered = hasFilter(state);
    const dots = dotsG.selectAll("circle");
    dots.classed("is-dimmed", (d) => filtered && !isActive(state, d));
    if (filtered) dots.filter((d) => isActive(state, d)).raise();
    if (key(state) !== periodKey) renderCorrelationLegend(state);
    applyHover(state);
    markLegend(legend, legendSel.active(state));
  }

  function applyHover(state) {
    const r = dotRadius();
    dotsG.selectAll("circle.is-hovered").classed("is-hovered", false).attr("r", r);
    if (state.hoveredId) {
      dotsG.selectAll("circle")
        .filter((d) => d.id === state.hoveredId)
        .classed("is-hovered", true).attr("r", r * 2).raise();
    }
  }

  function pointAt(event) {
    if (!points.length) return null;
    const [mx, my] = d3.pointer(event, g.node());
    const d = points[delaunay.find(mx, my)];
    return d && Math.hypot(px(d) - mx, py(d) - my) <= HOVER_RADIUS ? d : null;
  }

  function brushed(event) {
    if (!event.sourceEvent) return;
    if (!event.selection) {
      if (event.type !== "end") return;
      brushRect = null;
      const d = pointAt(event.sourceEvent);
      const onlyThis = d && last?.selectionSource === NAME && last.selectedIds?.size === 1 && last.selectedIds.has(d.id);
      if (d && !onlyThis) dispatcher.call("brushPoints", null, { ids: [d.id], source: NAME });
      else if (last?.selectionSource === NAME) dispatcher.call("brushPoints", null, { ids: null, source: NAME });
      return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    const ids = points
      .filter((d) => { const cx = px(d), cy = py(d); return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1; })
      .map((d) => d.id);
    brushRect = [[x.invert(x0), y.invert(y0)], [x.invert(x1), y.invert(y1)]];
    dispatcher.call("brushPoints", null, { ids, source: NAME });
    if (event.type === "end" && altZoom) zoomToRect(event.selection);
  }

  brushG
    .on("pointermove.hover", (event) => {
      if (event.buttons) return;
      const d = pointAt(event);
      brushG.select(".overlay").style("cursor", d ? "pointer" : null);
      if (d) {
        tooltip.show(tooltip.dayHtml(d, [enc.x, enc.y, enc.color]), event);
        dispatcher.call("hover", null, d.id);
      } else {
        tooltip.hide();
        dispatcher.call("hover", null, null);
      }
    })
    .on("pointerleave.hover", () => {
      tooltip.hide();
      dispatcher.call("hover", null, null);
    });

  function measure() {
    const box = area.node().getBoundingClientRect();
    svg.attr("width", box.width).attr("height", box.height);
    width = Math.max(10, box.width - MARGIN.left - MARGIN.right);
    height = Math.max(10, box.height - MARGIN.top - MARGIN.bottom);
  }

  return {
    update(state, reason) {
      last = state;
      if (reason === "hover") return applyHover(state);
      if (reason === "reset" && isZoomed(d3.zoomTransform(g.node()))) g.call(zoom.transform, d3.zoomIdentity);

      const wanted = state.encodings.scatter;
      const encodingChanged = !enc || CHANNELS.some((c) => enc[c] !== wanted[c]);
      if (encodingChanged) {
        syncControls(wanted);
        if (!enc) measure();
        render(state, Boolean(enc)); 
      } else if (state.selectionSource !== NAME) {
        brushRect = null;
        brushG.call(brush.move, null);
      }
      applySelection(state);
    },

    resize() {
      if (!enc) return;
      measure();
      render(last, false);
      applySelection(last);
    },
  };
}
