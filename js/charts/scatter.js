import { ATTRIBUTES, attrLabel, correlation } from "../data.js";
import { COLOR_ENCODINGS, colorScale, transitionMs, dotRadius } from "../theme.js";
import { isActive, hasFilter, inPeriod } from "../state.js";
import { renderLegend, markLegend, legendSelector } from "../legend.js";
import * as tooltip from "../tooltip.js";

const NAME = "scatter";
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
  const dotsG = g.append("g").attr("class", "dots");

  const brushG = g.append("g").attr("class", "brush");

  const note = root.append("div").attr("class", "chart-note");
  const legend = root.append("div").attr("class", "legend");

  let width = 0;
  let height = 0;
  let enc = null;         
  let points = [];    
  let x, y, color, delaunay;
  let periodKey = null;  
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

    const hidden = data.length - points.length;
    note.text(hidden ? `${hidden} day${hidden > 1 ? "s" : ""} not shown (missing ${[enc.x, enc.y]
      .filter((k) => data.some((d) => !finite(d[k]))).map((k) => ATTRIBUTES[k].label).join(" / ")} value)` : "");

    renderCorrelationLegend(state);
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

      const wanted = state.encodings.scatter;
      const encodingChanged = !enc || CHANNELS.some((c) => enc[c] !== wanted[c]);
      if (encodingChanged) {
        syncControls(wanted);
        if (!enc) measure();
        render(state, Boolean(enc)); 
      } else if (state.selectionSource !== NAME) {
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
