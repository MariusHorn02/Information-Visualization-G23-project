import { formatValue, SMOOTH_WINDOW } from "../data.js";
import { horizonColors, transitionMs } from "../theme.js";
import * as tooltip from "../tooltip.js";
import { zoomFilter, brushFilter, zoomResetButton, isZoomed, centeredTransform } from "../zoom.js";

const NAME = "horizon";
const MARGIN = { top: 4, right: 118, bottom: 22, left: 104 };
const ROW_GAP = 6;
const RUG_H = 8;
const MIN_ZOOM_DAYS = 14;
const DAY = 864e5;

const fmtDay = d3.utcFormat("%-d %b %Y");
const fmtShort = d3.utcFormat("%-d %b");

const fmtDev = (s, v) => (!Number.isFinite(v) ? "–"
  : s.relative ? d3.format("+.0%")(v) : `${d3.format("+.1f")(v)} °C`);
const fmtStep = (s) => (s.relative ? d3.format(".0%")(s.step) : `${s.step} °C`);

export function create(container, series, dispatcher) {
  const root = d3.select(container);

  const allDays = series[0].values;
  const dateById = new Map(allDays.map((d) => [d.id, d.date]));
  const fullRange = d3.extent(allDays, (d) => d.date);
  const years = d3.range(fullRange[0].getUTCFullYear(), fullRange[1].getUTCFullYear() + 1);
  const bisect = d3.bisector((d) => d.date);

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
      const range = yearRange(y);
      zoomTo(sameRange(range, last?.zoom) ? null : range);
    });
  const zoomBrushBtn = toolbar.append("button").attr("type", "button")
    .attr("class", "toggle toggle--action")
    .text("Zoom to period")
    .on("click", () => zoomToPeriod(last.timeRange));
  const showAllBtn = toolbar.append("button").attr("type", "button")
    .attr("class", "toggle toggle--action")
    .text("✕ Show all years")
    .on("click", () => zoomTo(null));
  const info = toolbar.append("span").attr("class", "toolbar-info");

  const area = root.append("div").attr("class", "chart-area");
  const svg = area.append("svg").attr("role", "img")
    .attr("aria-label", "Horizon chart of bike trips, temperature, car traffic and NO₂ relative to their average");
  const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  const defs = svg.append("defs");
  const clipId = "hz-focus-clip";
  const focusRect = defs.append("clipPath").attr("id", clipId)
    .append("rect").attr("y", -10);
  const plotClipId = "hz-plot-clip";
  const plotRect = defs.append("clipPath").attr("id", plotClipId)
    .append("rect").attr("y", -10);
  const rowsG = g.append("g").attr("class", "hz-rows");
  const rugG = g.append("g").attr("class", "hz-rug");
  const rugLabel = g.append("text").attr("class", "hz-rug__label").attr("text-anchor", "end")
    .attr("x", -12).attr("dy", "0.35em");
  const axisG = g.append("g").attr("class", "axis axis--x");
  const legendG = g.append("g").attr("class", "hz-legend");
  const rule = g.append("line").attr("class", "hz-rule").attr("y1", 0);
  const brushG = g.append("g").attr("class", "brush");
  const resetZoomBtn = zoomResetButton(area, () => g.call(zoom.transform, d3.zoomIdentity));

  let width = 0;
  let rowsH = 0;
  let rowH = 0;
  let x;
  let visible = [];      
  let drawnZoom = undefined;
  let last = null;
  // View zoom on top of the dashboard period (state.zoom). It only changes
  // what this chart shows; it doesn't filter the other views.
  let view = d3.zoomIdentity;

  const zoom = d3.zoom()
    .filter(zoomFilter)
    .on("zoom", (event) => {
      view = event.transform;
      if (!last) return;
      render(last);
      syncBrush(last);
      applyState(last);
    });
  g.call(zoom).on("dblclick.zoom", null);

  /** Zoom this chart's view to a marked period; the mark stays. */
  function zoomToPeriod([a, b]) {
    const pad = Math.max(0, (MIN_ZOOM_DAYS * DAY - (b - a + DAY)) / 2);
    const base = d3.scaleUtc().domain(last.zoom ?? fullRange).range([0, width]);
    const x0 = base(+a - pad);
    const x1 = base(+b + DAY + pad);
    const k = Math.max(1, Math.min(zoom.scaleExtent()[1], width / (x1 - x0)));
    g.transition().duration(transitionMs()).ease(d3.easeCubicInOut)
      .call(zoom.transform, centeredTransform([(x0 + x1) / 2, rowsH / 2], k, [width, rowsH]));
  }

  function resetView() {
    view = d3.zoomIdentity;
    g.property("__zoom", view);
  }

  let altZoom = false;  // this brush was started with Alt: zoom to it on release

  const brush = d3.brushX()
    .filter(brushFilter)
    .keyModifiers(false)
    .on("start", (event) => {
      if (!event.sourceEvent) return;
      altZoom = event.sourceEvent.altKey;
      tooltip.hide();
      dispatcher.call("hover", null, null);
    })
    .on("brush end", (event) => {
      if (!event.sourceEvent) return;
      if (!event.selection) {
        if (event.type === "end") dispatcher.call("brushTime", null, null);
        return;
      }
      const range = event.selection.map((px) => d3.utcDay.floor(x.invert(px)));
      dispatcher.call("brushTime", null, range);
      if (event.type === "end" && altZoom) zoomToPeriod(range);
    });

  function measure() {
    const box = area.node().getBoundingClientRect();
    svg.attr("width", box.width).attr("height", box.height);
    width = Math.max(10, box.width - MARGIN.left - MARGIN.right);
    const height = Math.max(40, box.height - MARGIN.top - MARGIN.bottom);
    rowsH = height - RUG_H - 2;
    rowH = (rowsH - ROW_GAP * (series.length - 1)) / series.length;
    const extent = [[0, 0], [width, rowsH]];
    zoom.extent(extent).translateExtent(extent);
    plotRect.attr("width", width).attr("height", rowsH + 20);
  }

  const slice = (values, [a, b]) => values.slice(bisect.left(values, a), bisect.right(values, b));
  // One extra point on each side so the bands run to the (clipped) edges.
  const slicePadded = (values, [a, b]) =>
    values.slice(Math.max(0, bisect.left(values, a) - 1), bisect.right(values, b) + 1);

  function render(state) {
    const colors = horizonColors();
    const base = state.zoom ?? fullRange;
    zoom.scaleExtent([1, Math.max(1, (base[1] - base[0]) / (MIN_ZOOM_DAYS * DAY))]);
    x = view.rescaleX(d3.scaleUtc().domain(base).range([0, width]));
    const domain = x.domain();
    visible = slice(allDays, domain);
    drawnZoom = state.zoom;

    rowsG.selectAll("g.hz-row")
      .data(series, (s) => s.key)
      .join((enter) => {
        const row = enter.append("g").attr("class", "hz-row");
        row.append("rect").attr("class", "hz-track");
        row.append("g").attr("class", "hz-bands hz-bands--dimmed").attr("clip-path", `url(#${plotClipId})`);
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

        const y = d3.scaleLinear().domain([0, step]).range([rowH, 0]);
        const layers = [];
        for (const [sign, palette] of [[1, colors.above], [-1, colors.below]]) {
          for (let i = 0; i < s.bands; i++) layers.push({ sign, i, color: palette[i], grey: colors.dimmed[i] });
        }
        const shown = slicePadded(values, domain);
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
    const zoomed = Boolean(state.zoom) || isZoomed(view);
    if (!zoomed) {
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
      .classed("is-link", !zoomed)
      .attr("role", zoomed ? null : "button")
      .on("click", zoomed ? null : (event, d) => zoomTo(yearRange(d.getUTCFullYear())));
    axisG.selectAll(".tick").selectAll("title")
      .data(zoomed ? [] : [0]).join("title").text("Show only this year");
  }

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
    const [v0, v1] = x.domain();
    const period = isZoomed(view) ? `${fmtDay(v0)} – ${fmtDay(v1)}`
      : !state.zoom ? "All years"
      : activeYear ? `${activeYear}`
      : `${fmtDay(state.zoom[0])} – ${fmtDay(state.zoom[1])}`;
    info.text(`${period} · ${smoothing}`);
    resetZoomBtn.attr("hidden", isZoomed(view) ? null : true);
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

    const [f0, f1] = state.timeRange
      ? [x(state.timeRange[0]), x(d3.utcDay.offset(state.timeRange[1], 1))]
      : [-1, width + 1];
    focusRect.attr("x", Math.max(-1, f0)).attr("width", Math.max(0, Math.min(width + 1, f1) - Math.max(-1, f0)))
      .attr("height", rowsH + 20);

    const current = d3.brushSelection(brushG.node());
    if (!state.timeRange && current) brushG.call(brush.move, null);
    if (state.timeRange && !current) syncBrush(state);
    renderToolbar(state);
    applyHover(state);
  }

  /** Place the brush over the marked period, clipped to the visible range. */
  function syncBrush(state) {
    const sel = state.timeRange?.map((d) => Math.max(0, Math.min(width, x(d))));
    brushG.call(brush.move, sel && sel[1] > sel[0] ? sel : null);
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
      if (event.buttons || !visible.length) return; 
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
        resetView();
        render(state);
        rowsG.style("opacity", 0.2).transition().duration(250).style("opacity", 1);
      } else if (reason === "reset" && isZoomed(view)) {
        resetView();
        render(state);
      }
      applyState(state);
    },
    resize() {
      if (!last) return;
      resetView();
      measure();
      render(last);
      syncBrush(last);
      applyState(last);
    },
  };
}
