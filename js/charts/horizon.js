import { formatValue, SMOOTH_WINDOW } from "../data.js";
import { horizonColors, transitionMs } from "../theme.js";
import * as tooltip from "../tooltip.js";
import { isPicked, hasPick } from "../state.js";
import { zoomFilter, brushFilter, zoomResetButton, isZoomed, centeredTransform } from "../zoom.js";

const NAME = "horizon";
const MARGIN = { top: 4, right: 16, bottom: 22, left: 104 };
const ROW_GAP = 6;
const RUG_H = 8;
const MIN_ZOOM_DAYS = 14;
const MIN_RUN_PX = 1.5;  // narrowest coloured strip for a selected day
const DAY = 864e5;

const fmtDay = d3.utcFormat("%-d %b %Y");
const fmtShort = d3.utcFormat("%-d %b");

const fmtDev = (s, v) => (!Number.isFinite(v) ? "–"
  : s.relative ? d3.format("+.0%")(v) : `${d3.format("+.1f")(v)} °C`);
const fmtStep = (s) => (s.relative ? d3.format(".0%")(s.step) : `${s.step} °C`);

// Short units for the labels under each strip name.
const SHORT_UNIT = { bike_trips: "/day", traffic_count: "/day", no2_ug_m3: " µg/m³", temp_c: " °C" };
const fmtNum = (v) => (Math.abs(v) >= 100 ? d3.format(",.0f")(v) : d3.format(".1~f")(v));
/** One shade's size in the strip's own unit (a % strip's step times its average). */
const shadeSize = (s) => (s.relative ? s.step * s.mean : s.step);
const avgText = (s) => `avg ${fmtNum(s.mean)}${SHORT_UNIT[s.key] ?? ""}`;

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
  const showAllSeriesBtn = toolbar.append("button").attr("type", "button")
    .attr("class", "toggle toggle--action")
    .text("✕ Show all series")
    .attr("hidden", true)
    .on("click", () => focusSeries(null));
  const legend = toolbar.append("div").attr("class", "hz-legend");
  const info = toolbar.append("span").attr("class", "toolbar-info");

  const area = root.append("div").attr("class", "chart-area");
  const svg = area.append("svg").attr("role", "img")
    .attr("aria-label", "Horizon chart of bike trips, temperature, car traffic and NO₂ relative to their average");
  const g = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  const defs = svg.append("defs");
  const clipId = "hz-focus-clip";
  // Coloured bands show through this clip; everything outside it stays grey.
  const focusClip = defs.append("clipPath").attr("id", clipId);
  const plotClipId = "hz-plot-clip";
  const plotRect = defs.append("clipPath").attr("id", plotClipId)
    .append("rect").attr("y", -10);
  const rowsG = g.append("g").attr("class", "hz-rows");
  const rugG = g.append("g").attr("class", "hz-rug");
  const rugLabel = g.append("text").attr("class", "hz-rug__label").attr("text-anchor", "end")
    .attr("x", -12).attr("dy", "0.35em");
  const axisG = g.append("g").attr("class", "axis axis--x");
  const rule = g.append("line").attr("class", "hz-rule").attr("y1", 0);
  const brushG = g.append("g").attr("class", "brush");
  const resetZoomBtn = zoomResetButton(area, () => g.call(zoom.transform, d3.zoomIdentity));

  let width = 0;
  let rowsH = 0;
  let rowH = 0;
  let focusKey = null;   // a series shown on its own, the others collapsed
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

  /** Show only one series (click its label), or all again with null. */
  function focusSeries(key) {
    focusKey = key;
    showAllSeriesBtn.attr("hidden", key ? null : true);
    if (!last) return;
    render(last);
    applyState(last);
    rowsG.style("opacity", 0.2).transition().duration(250).style("opacity", 1);
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

    const rows = focusKey ? series.filter((s) => s.key === focusKey) : series;
    rowH = (rowsH - ROW_GAP * (rows.length - 1)) / rows.length;

    rowsG.selectAll("g.hz-row")
      .data(rows, (s) => s.key)
      .join((enter) => {
        const row = enter.append("g").attr("class", "hz-row");
        row.append("rect").attr("class", "hz-track");
        row.append("g").attr("class", "hz-bands hz-bands--dimmed").attr("clip-path", `url(#${plotClipId})`);
        row.append("g").attr("class", "hz-bands hz-bands--focus").attr("clip-path", `url(#${clipId})`);
        const label = row.append("g").attr("class", "hz-label-group is-link").attr("role", "button")
          .on("click", (event, s) => focusSeries(focusKey === s.key ? null : s.key));
        label.append("rect").attr("class", "hz-label-hit");
        label.append("text").attr("class", "hz-label").attr("text-anchor", "end");
        label.append("text").attr("class", "hz-sublabel").attr("text-anchor", "end");
        label.append("title");
        return row;
      })
      .attr("transform", (s, i) => `translate(0,${i * (rowH + ROW_GAP)})`)
      .each(function (s) {
        const { step, values } = s;
        const row = d3.select(this);
        row.select(".hz-track").attr("width", width).attr("height", rowH);
        row.select(".hz-label").attr("x", -12).attr("y", rowH / 2 - 2).text(s.label);
        row.select(".hz-sublabel").attr("x", -12).attr("y", rowH / 2 + 12).text(avgText(s));
        row.select(".hz-label-hit").attr("x", -MARGIN.left).attr("width", MARGIN.left - 4).attr("height", rowH);
        row.select(".hz-label-group").classed("is-active", focusKey === s.key);
        row.select("title").text(`${s.label}: 2021–25 average ${formatValue(s.key, s.mean)}. `
          + `One shade = ${s.relative ? `${fmtStep(s)} of the average ≈ ` : ""}${formatValue(s.key, shadeSize(s))}. `
          + (focusKey === s.key ? "Click to show all strips." : `Click to show only ${s.label}.`));

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
    renderLegend(colors, rows);

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

  /** Legend for the deviation from the 2021–25 average: one ramp from far below
   *  (dark blue) to far above (dark orange). With one strip shown, the tooltip
   *  gives that strip's step size. */
  function renderLegend(colors, rows) {
    const only = rows.length === 1 ? rows[0] : null;
    legend.selectAll("*").remove();
    legend.attr("title", only
      ? `${only.label}: each shade = ${fmtStep(only)} from the 2021–2025 average.`
      : "Darker = further from the 2021–2025 average. Click a strip's name to see its step size.");
    legend.append("span").attr("class", "hz-legend__label").text("Below avg.");
    legend.append("span").attr("class", "hz-legend__ramp")
      .selectAll("span")
      .data([...colors.below.slice().reverse(), ...colors.above])
      .join("span")
      .style("background", (c) => c);
    legend.append("span").attr("class", "hz-legend__label").text("Above avg.");
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

  /** Pixel runs of consecutive days that stay coloured: inside the marked
   *  period, and among the selected / legend-filtered days if there are any. */
  function focusRuns(state) {
    if (!state.timeRange && !hasPick(state)) return [{ x0: -1, x1: width + 1 }];
    const runs = [];
    let run = null;
    for (const d of visible) {
      const on = inPeriod(state, d.date) && isPicked(state, d.id);
      if (!on) { run = null; continue; }
      const x0 = Math.max(-1, x(d.date));
      const x1 = Math.min(width + 1, x(d3.utcDay.offset(d.date, 1)));
      if (run) run.x1 = x1;
      else runs.push(run = { x0, x1 });
    }
    // On the full timeline one day is under 1 px; keep lone days visible.
    for (const r of runs) {
      if (r.x1 - r.x0 < MIN_RUN_PX) {
        const c = (r.x0 + r.x1) / 2;
        r.x0 = c - MIN_RUN_PX / 2;
        r.x1 = c + MIN_RUN_PX / 2;
      }
    }
    return runs;
  }

  function applyState(state) {
    // Rug: one tick per day that passes every filter, inside the visible range.
    const ids = hasPick(state)
      ? visible.filter((d) => inPeriod(state, d.date) && isPicked(state, d.id)).map((d) => d.id)
      : [];
    rugG.attr("transform", `translate(0,${rowsH + 1})`)
      .selectAll("line")
      .data(ids, (id) => id)
      .join("line")
      .attr("class", "hz-rug__tick")
      .attr("x1", (id) => x(dateById.get(id))).attr("x2", (id) => x(dateById.get(id)))
      .attr("y1", 0).attr("y2", RUG_H);
    rugLabel
      .attr("y", rowsH + 1 + RUG_H / 2)
      .classed("is-visible", hasPick(state))
      .text("Selected days")
      .append("title").text(`${ids.length} days selected or filtered in the scatterplot or calendar, shown on the timeline`);

    focusClip.selectAll("rect")
      .data(focusRuns(state))
      .join("rect")
      .attr("x", (r) => r.x0)
      .attr("width", (r) => r.x1 - r.x0)
      .attr("y", -10)
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
      const resetting = reason === "reset" && (isZoomed(view) || focusKey);
      if (state.zoom !== drawnZoom || resetting) {
        if (reason === "reset") {
          focusKey = null;
          showAllSeriesBtn.attr("hidden", true);
        }
        resetView();
        render(state);
        rowsG.style("opacity", 0.2).transition().duration(250).style("opacity", 1);
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
