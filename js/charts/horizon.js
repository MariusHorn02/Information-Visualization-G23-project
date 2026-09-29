// charts/horizon.js — horizon chart: four strips of deviation from average.
//
// Time on x. Each strip folds its deviation into 3 bands of height `step`,
// darker for larger deviations; negative values are mirrored upward. Hue shows
// the sign (orange above / blue below — no red), lightness and height the size.
// Four series fit in little height, with no shared axis across units.
//
// Interactions → events: year buttons / year labels / "Zoom to period" →
// "zoomTime" · 1D brush → "brushTime" · hover → "hover". From the state it
// draws a rule at the hovered day and a rug of days selected in other views.

import { formatValue, SMOOTH_WINDOW } from "../data.js";
import { horizonColors } from "../theme.js";
import * as tooltip from "../tooltip.js";

const NAME = "horizon";
const MARGIN = { top: 4, right: 118, bottom: 22, left: 104 };
const ROW_GAP = 6;
const RUG_H = 8;
const MIN_ZOOM_DAYS = 14;
const DAY = 864e5;

const fmtDay = d3.utcFormat("%-d %b %Y");
const fmtShort = d3.utcFormat("%-d %b");

/** Deviation text: "+23 %" for relative strips, "+3.2 °C" for temperature. */
const fmtDev = (s, v) => (!Number.isFinite(v) ? "–"
  : s.relative ? d3.format("+.0%")(v) : `${d3.format("+.1f")(v)} °C`);
const fmtStep = (s) => (s.relative ? d3.format(".0%")(s.step) : `${s.step} °C`);

export function create(container, series, dispatcher) {
  const root = d3.select(container);

  const allDays = series[0].values; // every series has the same days
  const dateById = new Map(allDays.map((d) => [d.id, d.date]));
  const fullRange = d3.extent(allDays, (d) => d.date);
  const years = d3.range(fullRange[0].getUTCFullYear(), fullRange[1].getUTCFullYear() + 1);
  const bisect = d3.bisector((d) => d.date);

  /** A calendar year, clipped to the dataset's range. */
  const yearRange = (y) => [
    new Date(Math.max(+fullRange[0], Date.UTC(y, 0, 1))),
    new Date(Math.min(+fullRange[1], Date.UTC(y, 11, 31))),
  ];
  const sameRange = (a, b) => a && b && +a[0] === +b[0] && +a[1] === +b[1];
  const inPeriod = (s, date) => !s.timeRange || (date >= s.timeRange[0] && date <= s.timeRange[1]);
  const zoomTo = (range) => dispatcher.call("zoomTime", null, range);

  const toolbar = root.append("div").attr("class", "controls hz-toolbar");
  const yearButtons = toolbar.append("div").attr("class", "toggle-group")
    .attr("role", "group").attr("aria-label", "Zoom to a year")
    .selectAll("button")
    .data(years)
    .join("button")
    .attr("type", "button")
    .attr("class", "toggle")
    .text((y) => y)
    .on("click", (event, y) => {
      // The active year again = back to all years.
      const range = yearRange(y);
      zoomTo(sameRange(range, last?.zoom) ? null : range);
    });
  const zoomBrushBtn = toolbar.append("button").attr("type", "button")
    .attr("class", "toggle toggle--action")
    .text("Zoom to period")
    .on("click", () => {
      const [a, b] = last.timeRange;
      // Minimum span, so a tiny brush still gives a readable zoom.
      const pad = Math.max(0, (MIN_ZOOM_DAYS * DAY - (b - a)) / 2);
      zoomTo([
        new Date(Math.max(+fullRange[0], +a - pad)),
        new Date(Math.min(+fullRange[1], +b + pad)),
      ].map((d) => d3.utcDay.floor(d)));
    });
  const showAllBtn = toolbar.append("button").attr("type", "button")
    .attr("class", "toggle toggle--action")
    .text("✕ Show all years")
    .on("click", () => zoomTo(null));
  const info = toolbar.append("span").attr("class", "toolbar-info");

  const area = root.append("div").attr("class", "chart-area");
  const svg = area.append("svg").attr("role", "img")
    .attr("aria-label", "Horizon chart of bike trips, temperature, car traffic and NO₂ relative to their average");
  const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  // Focus + context: bands are drawn twice, grey underneath and coloured on
  // top, clipped to the marked period, so days outside it turn grey.
  const clipId = "hz-focus-clip";
  const focusRect = svg.append("defs").append("clipPath").attr("id", clipId)
    .append("rect").attr("y", -10);
  const rowsG = g.append("g").attr("class", "hz-rows");
  // Rug: one tick per day selected in another view, showing WHEN those days happened.
  const rugG = g.append("g").attr("class", "hz-rug");
  const rugLabel = g.append("text").attr("class", "hz-rug__label").attr("text-anchor", "end")
    .attr("x", -12).attr("dy", "0.35em");
  const axisG = g.append("g").attr("class", "axis axis--x");
  const legendG = g.append("g").attr("class", "hz-legend");
  const rule = g.append("line").attr("class", "hz-rule").attr("y1", 0);
  const brushG = g.append("g").attr("class", "brush");

  let width = 0;
  let rowsH = 0;
  let rowH = 0;
  let x;
  let visible = [];          // days in the current x domain
  let drawnZoom = undefined;
  let last = null;

  const brush = d3.brushX()
    .on("start", (event) => {
      if (!event.sourceEvent) return;
      tooltip.hide();
      dispatcher.call("hover", null, null);
    })
    .on("brush end", (event) => {
      if (!event.sourceEvent) return; // ignore our own brush.move calls
      if (!event.selection) {
        if (event.type === "end") dispatcher.call("brushTime", null, null);
        return;
      }
      const range = event.selection.map((px) => d3.utcDay.floor(x.invert(px)));
      dispatcher.call("brushTime", null, range);
    });

  function measure() {
    const box = area.node().getBoundingClientRect();
    svg.attr("width", box.width).attr("height", box.height);
    width = Math.max(10, box.width - MARGIN.left - MARGIN.right);
    const height = Math.max(40, box.height - MARGIN.top - MARGIN.bottom);
    rowsH = height - RUG_H - 2;
    rowH = (rowsH - ROW_GAP * (series.length - 1)) / series.length;
  }

  /** Days inside [a, b] of a date-sorted array. */
  const slice = (values, [a, b]) => values.slice(bisect.left(values, a), bisect.right(values, b));

  function render(state) {
    const colors = horizonColors();
    const domain = state.zoom ?? fullRange;
    x = d3.scaleUtc().domain(domain).range([0, width]);
    visible = slice(allDays, domain);
    drawnZoom = state.zoom;

    rowsG.selectAll("g.hz-row")
      .data(series, (s) => s.key)
      .join((enter) => {
        const row = enter.append("g").attr("class", "hz-row");
        row.append("rect").attr("class", "hz-track");
        row.append("g").attr("class", "hz-bands hz-bands--dimmed");
        row.append("g").attr("class", "hz-bands hz-bands--focus").attr("clip-path", `url(#${clipId})`);
        row.append("text").attr("class", "hz-label").attr("text-anchor", "end");
        row.append("text").attr("class", "hz-sublabel").attr("text-anchor", "end");
        return row;
      })
      .attr("transform", (s, i) => `translate(0,${i * (rowH + ROW_GAP)})`)
      .each(function (s) {
        const { step, values } = s;
        const row = d3.select(this);
        row.select(".hz-track").attr("width", width).attr("height", rowH);
        row.select(".hz-label").attr("x", -12).attr("y", rowH / 2 - 2).text(s.label);
        row.select(".hz-sublabel").attr("x", -12).attr("y", rowH / 2 + 12)
          .text(`band = ${fmtStep(s)}`);

        // Band i shows the part of |dev| between i·step and (i+1)·step,
        // stretched to the full row height.
        const y = d3.scaleLinear().domain([0, step]).range([rowH, 0]);
        const layers = [];
        for (const [sign, palette] of [[1, colors.above], [-1, colors.below]]) {
          for (let i = 0; i < s.bands; i++) layers.push({ sign, i, color: palette[i], grey: colors.dimmed[i] });
        }
        const shown = slice(values, domain);
        const bandPath = (layer) => d3.area()
          .defined((d) => Number.isFinite(d.dev))
          .x((d) => x(d.date))
          .y0(rowH)
          .y1((d) => y(Math.min(step, Math.max(0, layer.sign * d.dev - layer.i * step))))
          .curve(d3.curveMonotoneX)(shown);

        const paths = layers.map(bandPath);
        row.select(".hz-bands--dimmed").selectAll("path")
          .data(layers)
          .join("path")
          .attr("fill", (l) => l.grey)
          .attr("d", (l, i) => paths[i]);
        row.select(".hz-bands--focus").selectAll("path")
          .data(layers)
          .join("path")
          .attr("fill", (l) => l.color)
          .attr("d", (l, i) => paths[i]);
      });

    renderAxis(state);
    rule.attr("y2", rowsH + RUG_H);
    renderLegend(colors);

    brush.extent([[0, 0], [width, rowsH]]);
    brushG.call(brush);
  }

  function renderAxis(state) {
    const axis = d3.axisBottom(x).tickSizeOuter(0);
    if (!state.zoom) {
      // One tick per year, plus the first day so the partial year 2021 is labelled.
      const [start, end] = x.domain();
      const yearTicks = d3.utcYears(d3.utcYear.ceil(start), end);
      const ticks = yearTicks.length && x(yearTicks[0]) - x(start) < 36 ? yearTicks : [start, ...yearTicks];
      axis.tickValues(ticks).tickFormat(d3.utcFormat("%Y"));
    } else {
      axis.ticks(Math.max(2, Math.floor(width / 90))).tickFormat((d) =>
        d3.utcFormat(+d3.utcYear(d) === +d ? "%Y" : +d3.utcMonth(d) === +d ? "%b" : "%-d %b")(d));
    }
    axisG.attr("transform", `translate(0,${rowsH + RUG_H + 2})`).call(axis);
    axisG.selectAll(".tick text")
      .classed("is-link", !state.zoom)
      .attr("role", state.zoom ? null : "button")
      .on("click", state.zoom ? null : (event, d) => zoomTo(yearRange(d.getUTCFullYear())));
    axisG.selectAll(".tick").selectAll("title")
      .data(state.zoom ? [] : [0]).join("title").text("Show only this year");
  }

  // Legend as in the sketch: darkest orange on top, darkest blue at the bottom.
  function renderLegend(colors) {
    const swatches = [...colors.above.slice().reverse(), ...colors.below];
    const sw = 12;
    const gap = 3;
    const total = swatches.length * (sw + gap) + 28;
    const top = Math.max(0, (rowsH - total) / 2);
    legendG.attr("transform", `translate(${width + 22},${top})`);
    legendG.selectAll("*").remove();
    legendG.append("text").attr("class", "hz-legend__label").attr("y", 9).text("Above avg.");
    legendG.selectAll("rect").data(swatches).join("rect")
      .attr("y", (c, i) => 16 + i * (sw + gap)).attr("width", 26).attr("height", sw).attr("rx", 2)
      .attr("fill", (c) => c);
    legendG.append("text").attr("class", "hz-legend__label")
      .attr("y", 16 + swatches.length * (sw + gap) + 9).text("Below avg.");
  }

  function renderToolbar(state) {
    yearButtons.classed("is-active", (y) => sameRange(yearRange(y), state.zoom))
      .attr("aria-pressed", (y) => String(sameRange(yearRange(y), state.zoom)));
    zoomBrushBtn.attr("hidden", state.timeRange ? null : true);
    showAllBtn.attr("hidden", state.zoom ? null : true);

    const smoothing = `${SMOOTH_WINDOW}-day mean`;
    const activeYear = years.find((y) => sameRange(yearRange(y), state.zoom));
    const period = !state.zoom ? "All years"
      : activeYear ? `${activeYear}`
      : `${fmtDay(state.zoom[0])} – ${fmtDay(state.zoom[1])}`;
    info.text(`${period} · ${smoothing}`);
  }

  function applyState(state) {
    const [a, b] = x.domain();
    const ids = state.selectedIds
      ? [...state.selectedIds].filter((id) => { const d = dateById.get(id); return d >= a && d <= b; })
      : [];
    rugG.attr("transform", `translate(0,${rowsH + 1})`)
      .selectAll("line")
      .data(ids, (id) => id)
      .join("line")
      .attr("class", "hz-rug__tick")
      .attr("x1", (id) => x(dateById.get(id))).attr("x2", (id) => x(dateById.get(id)))
      .attr("y1", 0).attr("y2", RUG_H)
      .classed("is-dimmed", (id) => !inPeriod(state, dateById.get(id)));
    rugLabel
      .attr("y", rowsH + 1 + RUG_H / 2)
      .classed("is-visible", Boolean(state.selectedIds))
      .text("Selected days")
      .append("title").text(`${ids.length} days selected in the scatterplot or calendar, shown on the timeline`);

    // Clip to the marked period (from the first day's start to the last day's end).
    const [f0, f1] = state.timeRange
      ? [x(state.timeRange[0]), x(d3.utcDay.offset(state.timeRange[1], 1))]
      : [-1, width + 1];
    focusRect.attr("x", Math.max(-1, f0)).attr("width", Math.max(0, Math.min(width + 1, f1) - Math.max(-1, f0)))
      .attr("height", rowsH + 20);

    // Keep the brush in sync with state.timeRange (Reset, zoom).
    const current = d3.brushSelection(brushG.node());
    if (!state.timeRange && current) brushG.call(brush.move, null);
    if (state.timeRange && !current) brushG.call(brush.move, state.timeRange.map(x));
    renderToolbar(state);
    applyHover(state);
  }

  function applyHover(state) {
    const date = state.hoveredId && dateById.get(state.hoveredId);
    const [a, b] = x.domain();
    const shown = Boolean(date) && date >= a && date <= b;
    rule.classed("is-visible", shown);
    if (shown) rule.attr("x1", x(date)).attr("x2", x(date));
  }

  function tooltipHtml(i) {
    const day = visible[i];
    const rows = series.map((s) => {
      const v = s.values[bisect.left(s.values, day.date)];
      return `<tr><td>${s.label}</td><td>${formatValue(s.key, v.smooth)}</td>
        <td class="muted">${fmtDev(s, v.dev)}</td></tr>`;
    });
    return `<h3>${fmtShort(day.from)} – ${fmtDay(day.to)}</h3>
      <div class="muted">${SMOOTH_WINDOW}-day mean around ${tooltip.fmtDate(day.date)} · vs. 2021–25 average</div>
      <table>${rows.join("")}</table>`;
  }

  brushG
    .on("pointermove.hover", (event) => {
      if (event.buttons || !visible.length) return; // while brushing
      const [mx] = d3.pointer(event, g.node());
      const i = Math.min(visible.length - 1, bisect.center(visible, x.invert(mx)));
      tooltip.show(tooltipHtml(i), event);
      dispatcher.call("hover", null, visible[i].id);
    })
    .on("pointerleave.hover", () => {
      tooltip.hide();
      dispatcher.call("hover", null, null);
    });

  return {
    update(state, reason) {
      last = state;
      if (reason === "init") { measure(); render(state); }
      if (reason === "hover") return applyHover(state);
      if (state.zoom !== drawnZoom) {
        render(state);
        // Short fade so the new time scale reads as a zoom.
        rowsG.style("opacity", 0.2).transition().duration(250).style("opacity", 1);
      }
      applyState(state);
    },
    resize() {
      if (!last) return;
      measure();
      render(last);
      brushG.call(brush.move, last.timeRange ? last.timeRange.map(x) : null);
      applyState(last);
    },
  };
}
