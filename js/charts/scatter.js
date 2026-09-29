// charts/scatter.js — scatterplot: one point per day.
//
// X and Y = two quantitative attributes on position (the most accurate channel
// for correlation); colour = a categorical attribute on hue. All three are
// switchable, so one view serves several tasks. The dot pattern shows the
// correlation; the legend adds Pearson r per colour group (e.g. per season),
// computed on the days in the chosen period. Avoid occlusion: small
// transparent dots, dry days jittered.
//
// Interactions → events: dropdowns → "encode" (animated) · hover → "hover" ·
// click a point or 2D brush → "brushPoints" · legend click → "brushPoints".

import { ATTRIBUTES, attrLabel, correlation } from "../data.js";
import { COLOR_ENCODINGS, colorScale, transitionMs, dotRadius } from "../theme.js";
import { isActive, hasFilter, inPeriod } from "../state.js";
import { renderLegend, markLegend, legendSelector } from "../legend.js";
import * as tooltip from "../tooltip.js";

const NAME = "scatter";
const MARGIN = { top: 10, right: 18, bottom: 42, left: 70 };
const HOVER_RADIUS = 14; // px: max pointer distance to count as hovering/clicking a point
const JITTER = 5;        // px: max sideways offset for zero values (dry days)
const CHANNELS = ["x", "y", "color"];

const finite = Number.isFinite;
const fmtR = d3.format("+.2f");

/** Stable pseudo-random value in [−1, 1] per day id: jitter never moves between redraws. */
function jitterOf(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

export function create(container, data, dispatcher) {
  const root = d3.select(container);

  const controls = root.append("div").attr("class", "controls");
  const selects = {
    x: addSelect("x", "X", Object.keys(ATTRIBUTES), attrLabel),
    y: addSelect("y", "Y", Object.keys(ATTRIBUTES), attrLabel),
    color: addSelect("color", "Color", Object.keys(COLOR_ENCODINGS), (k) => COLOR_ENCODINGS[k].label),
  };

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
  const dotsG = g.append("g").attr("class", "dots");
  // The brush lies on top so a drag can start anywhere; hover and click use a
  // Delaunay nearest-point search instead of per-circle events.
  const brushG = g.append("g").attr("class", "brush");

  const note = root.append("div").attr("class", "chart-note");
  const legend = root.append("div").attr("class", "legend");

  let width = 0;
  let height = 0;
  let enc = null;          // encoding currently drawn
  let points = [];         // days with both an x and a y value
  let x, y, color, delaunay;
  let periodKey = null;    // period the legend (counts, r) was computed for
  let last = null;
  const legendSel = legendSelector(dispatcher, `${NAME}:legend`, () => data,
    () => COLOR_ENCODINGS[enc.color].field);

  const offset = (key, d) => (ATTRIBUTES[key].jitterZero && d[key] === 0 ? jitterOf(d.id) * JITTER : 0);
  const px = (d) => x(d[enc.x]) + offset(enc.x, d);
  const py = (d) => y(d[enc.y]) - offset(enc.y, d);

  const brush = d3.brush()
    .on("start", (event) => {
      if (!event.sourceEvent) return;
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

  // A jittered axis starts JITTER px in, so dry days don't spill over the axis.
  function makeScale(key, [r0, r1]) {
    const pad = ATTRIBUTES[key].jitterZero ? JITTER + 1 : 0;
    const dir = r1 > r0 ? 1 : -1;
    return d3.scaleLinear()
      .domain(d3.extent(points, (d) => d[key]))
      .range([r0 + dir * pad, r1])
      .nice();
  }

  /** Full redraw; animated on re-encoding. */
  function render(state, animate) {
    enc = { ...state.encodings.scatter };
    points = data.filter((d) => finite(d[enc.x]) && finite(d[enc.y]));

    x = makeScale(enc.x, [0, width]);
    y = makeScale(enc.y, [height, 0]);
    color = colorScale(enc.color, data);

    const t = animate
      ? svg.transition("encode").duration(transitionMs()).ease(d3.easeCubicInOut)
      : null;
    const T = (sel) => (t ? sel.transition(t) : sel.interrupt());

    svg.attr("aria-label", `Scatterplot of ${attrLabel(enc.y)} against ${attrLabel(enc.x)}, coloured by ${COLOR_ENCODINGS[enc.color].label}`);

    const xTicks = Math.max(2, Math.floor(width / 80));
    const yTicks = Math.max(2, Math.floor(height / 50));
    T(axisX.attr("transform", `translate(0,${height})`)).call(d3.axisBottom(x).ticks(xTicks));
    T(axisY).call(d3.axisLeft(y).ticks(yTicks));
    T(gridX).call(d3.axisBottom(x).ticks(xTicks).tickSize(height).tickFormat(""));
    T(gridY).call(d3.axisLeft(y).ticks(yTicks).tickSize(-width).tickFormat(""));

    labelX.attr("x", width / 2).attr("y", height + 36).text(attrLabel(enc.x));
    labelY.attr("x", -height / 2).attr("y", -56).text(attrLabel(enc.y));

    // Keyed by day id, so a re-encoding moves each day to its new place.
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
    // The old brush rectangle belongs to the old axes; the selection itself stays in state.
    brushG.call(brush.move, null);

    const hidden = data.length - points.length;
    note.text(hidden ? `${hidden} day${hidden > 1 ? "s" : ""} not shown (missing ${[enc.x, enc.y]
      .filter((k) => data.some((d) => !finite(d[k]))).map((k) => ATTRIBUTES[k].label).join(" / ")} value)` : "");

    renderCorrelationLegend(state);
  }

  // Legend: day counts and correlation r per colour group, for the days in
  // the chosen period (one overall r for a continuous colour).
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
      extra: (v) => (rOf.get(v) != null ? `r = ${fmtR(rOf.get(v))}` : null),
    });
    const overall = r(inScope);
    legend.append("span").attr("class", "legend__note")
      .attr("title", "Pearson correlation between X and Y: −1 perfect negative, 0 none, +1 perfect positive")
      .text(ce.type === "sequential"
        ? `correlation r = ${overall == null ? "–" : fmtR(overall)}`
        : `r = correlation of X and Y per group${overall == null ? "" : ` · all: ${fmtR(overall)}`}`);
    markLegend(legend, legendSel.active(state));
  }

  const key = (s) => `${s.zoom?.map(Number)}|${s.timeRange?.map(Number)}`;

  /** Selection and hover styling only; no layout change. */
  function applySelection(state) {
    const filtered = hasFilter(state);
    const dots = dotsG.selectAll("circle");
    dots.classed("is-dimmed", (d) => filtered && !isActive(state, d));
    // Selected days drawn above the grey ones.
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

  /** The point under the pointer (within HOVER_RADIUS), or null. */
  function pointAt(event) {
    if (!points.length) return null;
    const [mx, my] = d3.pointer(event, g.node());
    const d = points[delaunay.find(mx, my)];
    return d && Math.hypot(px(d) - mx, py(d) - my) <= HOVER_RADIUS ? d : null;
  }

  function brushed(event) {
    if (!event.sourceEvent) return; // ignore programmatic brush.move calls
    if (!event.selection) {
      if (event.type !== "end") return;
      // Click without drag: select that day (again = clear), or clear on empty space.
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
    dispatcher.call("brushPoints", null, { ids, source: NAME });
  }

  brushG
    .on("pointermove.hover", (event) => {
      if (event.buttons) return; // while brushing
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

      const wanted = state.encodings.scatter;
      const encodingChanged = !enc || CHANNELS.some((c) => enc[c] !== wanted[c]);
      if (encodingChanged) {
        for (const c of ["x", "y", "color"]) selects[c].property("value", wanted[c]);
        if (!enc) measure();
        render(state, Boolean(enc)); // no animation on the first draw
      } else if (state.selectionSource !== NAME) {
        // Selection came from elsewhere: our brush rectangle no longer describes it.
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
