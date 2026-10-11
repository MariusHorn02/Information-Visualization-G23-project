import { COLOR_ENCODINGS, colorScale, cssVar, transitionMs } from "../theme.js";
import { inPeriod, isActive } from "../state.js";
import { renderLegend, markLegend, legendSelector } from "../legend.js";
import * as tooltip from "../tooltip.js";
import { zoomFilter, zoomResetButton, isZoomed, centeredTransform } from "../zoom.js";

const NAME = "calendar";
const MAX_ZOOM = 8;
const MEASURES = [
  { key: "bike_trips", label: "Bike trips / day" },
  { key: "temp_c", label: "Temperature" },
  { key: "rain_category", label: "Rain" },
  { key: "traffic_count", label: "Traffic" },
  { key: "bike_avg_duration_min", label: "Trip duration" },
];
const WEEKS = 54;            
const YEAR_GAP = 1.4;       
const LEFT = 58;             
const TOP = 16;          

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const WEEKDAY_NAMES = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const ADD_HINT = "Click more to add them; click again to remove";

export function create(container, years, dispatcher) {
  const root = d3.select(container);
  const allDays = years.flatMap((y) => y.days);
  const rows = allDays.filter((d) => d.row).map((d) => d.row);
  // Day ids per month (in every year), weekday and year, for one-click group selection.
  const idsBy = (key) => d3.group(allDays.filter((d) => d.row), key);
  const monthIds = idsBy((d) => d.date.getUTCMonth());
  const weekdayIds = idsBy((d) => d.weekday);
  const yearIds = idsBy((d) => d.date.getUTCFullYear());
  const idsOf = (map, k) => (map.get(k) ?? []).map((d) => d.id);

  const controls = root.append("div").attr("class", "controls");
  const buttons = controls.selectAll("button")
    .data(MEASURES)
    .join("button")
    .attr("type", "button")
    .attr("class", "toggle")
    .text((m) => m.label)
    .on("click", (event, m) => dispatcher.call("encode", null, { chart: NAME, measure: m.key }));

  const area = root.append("div").attr("class", "chart-area");
  const svg = area.append("svg").attr("role", "img");
  // Zooming scales the whole calendar, so cells, labels and gaps grow together.
  const zoomG = svg.append("g");
  const g = zoomG.append("g");
  const resetZoomBtn = zoomResetButton(area, () => svg.call(zoom.transform, d3.zoomIdentity));
  const zoom = d3.zoom()
    .scaleExtent([1, MAX_ZOOM])
    .filter(zoomFilter)
    .on("zoom", (event) => {
      zoomG.attr("transform", event.transform);
      resetZoomBtn.attr("hidden", isZoomed(event.transform) ? null : true);
    });
  svg.call(zoom).on("dblclick.zoom", null);
  const monthsG = g.append("g").attr("class", "cal-months");
  const yearsG = g.append("g").attr("class", "cal-years");
  const legend = root.append("div").attr("class", "legend");

  let measure = null;
  let color;
  let cell = 10;
  let origin = [0, 0];  // top-left of the first year block, in svg pixels
  let size = [0, 0];
  let last = null;
  let periodKey = null;     
  const legendSel = legendSelector(dispatcher, `${NAME}:legend`, () => rows,
    () => COLOR_ENCODINGS[measure].field);

  function layout() {
    const box = area.node().getBoundingClientRect();
    svg.attr("width", box.width).attr("height", box.height);
    const extent = [[0, 0], [box.width, box.height]];
    zoom.extent(extent).translateExtent(extent);
    svg.call(zoom.transform, d3.zoomIdentity);
    const byWidth = (box.width - LEFT - 4) / WEEKS;
    const byHeight = (box.height - TOP - 2) / (years.length * 7 + (years.length - 1) * YEAR_GAP);
    cell = Math.max(3, Math.floor(Math.min(byWidth, byHeight) * 2) / 2);
    const gridW = LEFT + WEEKS * cell;
    origin = [Math.max(0, (box.width - gridW) / 2) + LEFT, TOP];
    size = [box.width, box.height];
    g.attr("transform", `translate(${origin})`);
  }

  const yearY = (i) => i * cell * (7 + YEAR_GAP);

  function render() {
    const pad = cell >= 6 ? 1 : 0.5;
    const nodata = cssVar("--color-nodata");

    const monthFmt = d3.utcFormat("%b");
    const firstYear = years[0].year;
    monthsG.selectAll("text")
      .data(d3.utcMonths(new Date(Date.UTC(firstYear, 0, 1)), new Date(Date.UTC(firstYear + 1, 0, 1))))
      .join((enter) => enter.append("text")
        .attr("class", "cal-label cal-month is-link")
        .attr("role", "button")
        .on("click", (event, m) => pick(idsOf(monthIds, m.getUTCMonth()))))
      .attr("x", (m) => (d3.utcMonday.count(d3.utcYear(m), m) + 2) * cell)
      .attr("y", -5)
      .attr("text-anchor", "middle")
      .text((m) => (cell >= 12 ? monthFmt(m) : monthFmt(m)[0]))
      .append("title").text((m) => `Select every ${MONTH_NAMES[m.getUTCMonth()]} (all years). ${ADD_HINT}, e.g. Jun + Jul + Aug = summer.`);

    const blocks = yearsG.selectAll("g.cal-year")
      .data(years, (y) => y.year)
      .join((enter) => {
        const b = enter.append("g").attr("class", "cal-year");
        b.append("text").attr("class", "cal-year__label is-link").attr("text-anchor", "end")
          .attr("role", "button")
          .on("click", (event, y) => pick(idsOf(yearIds, y.year)));
        b.append("g").attr("class", "cal-weekdays");
        b.append("g").attr("class", "cal-cells");
        return b;
      })
      .attr("transform", (y, i) => `translate(0,${yearY(i)})`);

    blocks.select(".cal-year__label")
      .attr("x", -16).attr("y", 3.5 * cell).attr("dy", "0.35em")
      .text((y) => y.year)
      .append("title").text(`Select every day of this year. ${ADD_HINT}.`);

    const weekdays = blocks.select(".cal-weekdays").selectAll("g.cal-weekday")
      .data(cell >= 5 ? WEEKDAYS.map((letter, i) => ({ letter, i })) : [])
      .join((enter) => {
        const w = enter.append("g").attr("class", "cal-weekday is-link").attr("role", "button");
        w.append("rect").attr("class", "cal-weekday__hit");
        w.append("text").attr("class", "cal-label").attr("text-anchor", "end").attr("dy", "0.35em");
        w.append("title");
        return w;
      })
      .on("click", (event, d) => pick(idsOf(weekdayIds, d.i)));
    weekdays.select("rect").attr("x", -12).attr("y", (d) => d.i * cell).attr("width", 11).attr("height", cell);
    weekdays.select("text").attr("x", -3).attr("y", (d) => (d.i + 0.5) * cell)
      .style("font-size", `${Math.min(10, cell + 1)}px`).text((d) => d.letter);
    weekdays.select("title").text((d) => `Select all ${WEEKDAY_NAMES[d.i]}. ${ADD_HINT}, e.g. S + S = weekends.`);

    blocks.select(".cal-cells").selectAll("rect")
      .data((y) => y.days, (d) => d.id)
      .join("rect")
      .attr("class", "cal-cell")
      .classed("is-nodata", (d) => !d.row)
      .attr("x", (d) => d.week * cell)
      .attr("y", (d) => d.weekday * cell)
      .attr("width", cell - pad)
      .attr("height", cell - pad)
      .attr("fill", nodata);

    recolor(last);
  }

  function recolor(state) {
    const ce = COLOR_ENCODINGS[measure];
    color = colorScale(measure, rows);
    const nodata = cssVar("--color-nodata");
    const value = (d) => d.row?.[ce.field];
    yearsG.selectAll(".cal-cell")
      .attr("fill", (d) => {
        const v = value(d);
        return v == null || Number.isNaN(v) ? nodata : color(v);
      });
    svg.attr("aria-label", `Calendar heatmap of ${ce.label} per day, ${years[0].year}–${years.at(-1).year}`);
    buttons.classed("is-active", (m) => m.key === measure);
    renderCalendarLegend(state);
  }

  function renderCalendarLegend(state) {
    const ce = COLOR_ENCODINGS[measure];
    const scope = state ? rows.filter((d) => inPeriod(state, d)) : rows;
    periodKey = key(state);
    renderLegend(legend, measure, color, {
      counts: d3.rollup(scope, (v) => v.length, (d) => d[ce.field]),
      showCounts: true,
      onSelect: (v) => legendSel.select(v, last),
    });
    legend.append("span").attr("class", "legend__item legend__item--static")
      .call((s) => s.append("span").attr("class", "legend__swatch legend__swatch--square").style("background", cssVar("--color-nodata")))
      .call((s) => s.append("span").text("no data"));
    if (state) markLegend(legend, legendSel.active(state));
  }

  const key = (s) => `${s?.zoom?.map(Number)}|${s?.timeRange?.map(Number)}`;

  /** The calendar's own current selection (empty if the selection came from elsewhere). */
  const ownSelection = () =>
    new Set(last?.selectionSource === NAME && last.selectedIds ? last.selectedIds : []);

  const emit = (set) => dispatcher.call("brushPoints", null, { ids: set.size ? [...set] : null, source: NAME });

  /** Toggle a group of days (one day, a month, a weekday, a year): every click
   *  adds the group to the selection, or removes it if it is already all
   *  selected. So T then W selects Tuesdays and Wednesdays; Reset clears it. */
  function pick(ids) {
    if (!ids.length) return;
    const own = ownSelection();
    const allIn = ids.every((id) => own.has(id));
    ids.forEach((id) => (allIn ? own.delete(id) : own.add(id)));
    emit(own);
  }

  /** A group label is active when all of its days are in the calendar's selection. */
  const groupActive = (own, ids) => own.size > 0 && ids.length > 0 && ids.every((id) => own.has(id));

  function applySelection(state) {
    yearsG.selectAll(".cal-cell")
      // Only days that pass the period, the selection and the legend filter keep their colour.
      .classed("is-dimmed", (d) => d.row && !isActive(state, d.row));
    const own = new Set(state.selectionSource === NAME && state.selectedIds ? state.selectedIds : []);
    yearsG.selectAll(".cal-year__label").classed("is-active", (y) => groupActive(own, idsOf(yearIds, y.year)));
    yearsG.selectAll(".cal-weekday").classed("is-active", (d) => groupActive(own, idsOf(weekdayIds, d.i)));
    monthsG.selectAll(".cal-month").classed("is-active", (m) => groupActive(own, idsOf(monthIds, m.getUTCMonth())));
    if (key(state) !== periodKey) renderCalendarLegend(state);
    markLegend(legend, legendSel.active(state));
    applyHover(state);
  }

  function applyHover(state) {
    yearsG.selectAll(".cal-cell.is-hovered").classed("is-hovered", false);
    if (state.hoveredId) {
      yearsG.selectAll(".cal-cell").filter((d) => d.id === state.hoveredId)
        .classed("is-hovered", true).raise();
    }
  }

  let anchor = null;  
  let dragged = false;
  let lastCell = null;  // the day the drag currently ends on
  let altZoom = false;  // the drag was started with Alt: zoom to it on release
  let dragBase = new Set();  // selection the dragged range is added to

  /** Zoom so the days from a to b fill the view. */
  function zoomToDays(a, b) {
    const [from, to] = a.date <= b.date ? [a.date, b.date] : [b.date, a.date];
    const firstYear = years[0].year;
    const xs = [];
    const ys = [];
    for (const d of allDays) {
      if (d.date < from || d.date > to) continue;
      xs.push(origin[0] + d.week * cell);
      ys.push(origin[1] + yearY(d.date.getUTCFullYear() - firstYear) + d.weekday * cell);
    }
    const [x0, x1] = [d3.min(xs), d3.max(xs) + cell];
    const [y0, y1] = [d3.min(ys), d3.max(ys) + cell];
    const k = Math.max(1, Math.min(MAX_ZOOM, 0.85 * Math.min(size[0] / (x1 - x0), size[1] / (y1 - y0))));
    svg.transition().duration(transitionMs()).ease(d3.easeCubicInOut)
      .call(zoom.transform, centeredTransform([(x0 + x1) / 2, (y0 + y1) / 2], k, size));
  }

  /** Drag: add the range a–b to the selection. */
  const selectRange = (a, b) => {
    const [from, to] = a.date <= b.date ? [a.date, b.date] : [b.date, a.date];
    const set = new Set(dragBase);
    allDays.forEach((d) => { if (d.row && d.date >= from && d.date <= to) set.add(d.id); });
    emit(set);
  };

  const cellDatum = (event) => (event.target.classList.contains("cal-cell") ? d3.select(event.target).datum() : null);

  yearsG
    .on("pointerdown", (event) => {
      const d = cellDatum(event);
      if (!d?.row || event.shiftKey) return; // Shift+drag pans the zoomed view
      event.preventDefault();
      anchor = lastCell = d;
      dragged = false;
      altZoom = event.altKey;
      dragBase = ownSelection();
      tooltip.hide();
    })
    .on("pointerover", (event) => {
      const d = cellDatum(event);
      if (!d) return;
      if (anchor) {
        if (d.row && d !== anchor) { dragged = true; lastCell = d; selectRange(anchor, d); }
        return;
      }
      if (!d.row) { tooltip.hide(); dispatcher.call("hover", null, null); return; }
      tooltip.show(tooltip.dayHtml(d.row, [COLOR_ENCODINGS[measure].field]), event);
      dispatcher.call("hover", null, d.id);
    })
    .on("pointermove", (event) => { if (!anchor && cellDatum(event)) tooltip.move(event); })
    .on("pointerleave", () => {
      tooltip.hide();
      dispatcher.call("hover", null, null);
    });

  d3.select(window).on(`pointerup.${NAME}`, () => {
    if (!anchor) return;
    if (!dragged) pick([anchor.id]);
    if (altZoom) zoomToDays(anchor, lastCell);
    anchor = null;
  });

  return {
    update(state, reason) {
      last = state;
      if (reason === "hover") return applyHover(state);
      if (reason === "reset") svg.call(zoom.transform, d3.zoomIdentity);
      const wanted = state.encodings.calendar.measure;
      if (reason === "init") {
        measure = wanted;
        layout();
        render();
      } else if (wanted !== measure) {
        measure = wanted;
        recolor(state);
      }
      applySelection(state);
    },
    resize() {
      if (!last) return;
      layout();
      render();
      applySelection(last);
    },
  };
}
