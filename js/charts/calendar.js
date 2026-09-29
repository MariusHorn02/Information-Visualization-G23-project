import { COLOR_ENCODINGS, colorScale, cssVar } from "../theme.js";
import { inPeriod } from "../state.js";
import { renderLegend, markLegend, legendSelector } from "../legend.js";
import * as tooltip from "../tooltip.js";

const NAME = "calendar";
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

export function create(container, years, dispatcher) {
  const root = d3.select(container);
  const allDays = years.flatMap((y) => y.days);
  const rows = allDays.filter((d) => d.row).map((d) => d.row);
  const dataRange = d3.extent(rows, (d) => d.date);

  const yearRange = (y) => [
    new Date(Math.max(+dataRange[0], Date.UTC(y, 0, 1))),
    new Date(Math.min(+dataRange[1], Date.UTC(y, 11, 31))),
  ];
  const sameRange = (a, b) => a && b && +a[0] === +b[0] && +a[1] === +b[1];

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
  const g = svg.append("g");
  const monthsG = g.append("g").attr("class", "cal-months");
  const yearsG = g.append("g").attr("class", "cal-years");
  const legend = root.append("div").attr("class", "legend");

  let measure = null;
  let color;
  let cell = 10;
  let last = null;
  let periodKey = null;     
  let weekdaySel = null;
  const legendSel = legendSelector(dispatcher, `${NAME}:legend`, () => rows,
    () => COLOR_ENCODINGS[measure].field);

  function layout() {
    const box = area.node().getBoundingClientRect();
    svg.attr("width", box.width).attr("height", box.height);
    const byWidth = (box.width - LEFT - 4) / WEEKS;
    const byHeight = (box.height - TOP - 2) / (years.length * 7 + (years.length - 1) * YEAR_GAP);
    cell = Math.max(3, Math.floor(Math.min(byWidth, byHeight) * 2) / 2);
    const gridW = LEFT + WEEKS * cell;
    g.attr("transform", `translate(${Math.max(0, (box.width - gridW) / 2) + LEFT},${TOP})`);
  }

  const yearY = (i) => i * cell * (7 + YEAR_GAP);

  function render() {
    const pad = cell >= 6 ? 1 : 0.5;
    const nodata = cssVar("--color-nodata");

    const monthFmt = d3.utcFormat("%b");
    const firstYear = years[0].year;
    monthsG.selectAll("text")
      .data(d3.utcMonths(new Date(Date.UTC(firstYear, 0, 1)), new Date(Date.UTC(firstYear + 1, 0, 1))))
      .join("text")
      .attr("class", "cal-label")
      .attr("x", (m) => (d3.utcMonday.count(d3.utcYear(m), m) + 2) * cell)
      .attr("y", -5)
      .attr("text-anchor", "middle")
      .text((m) => (cell >= 12 ? monthFmt(m) : monthFmt(m)[0]));

    const blocks = yearsG.selectAll("g.cal-year")
      .data(years, (y) => y.year)
      .join((enter) => {
        const b = enter.append("g").attr("class", "cal-year");
        b.append("text").attr("class", "cal-year__label is-link").attr("text-anchor", "end")
          .attr("role", "button")
          .on("click", (event, y) => {
            const range = yearRange(y.year);
            dispatcher.call("zoomTime", null, sameRange(range, last?.zoom) ? null : range);
          });
        b.append("g").attr("class", "cal-weekdays");
        b.append("g").attr("class", "cal-cells");
        return b;
      })
      .attr("transform", (y, i) => `translate(0,${yearY(i)})`);

    blocks.select(".cal-year__label")
      .attr("x", -16).attr("y", 3.5 * cell).attr("dy", "0.35em")
      .text((y) => y.year)
      .append("title").text("Show only this year (click again for all years)");

    const weekdays = blocks.select(".cal-weekdays").selectAll("g.cal-weekday")
      .data(cell >= 5 ? WEEKDAYS.map((letter, i) => ({ letter, i })) : [])
      .join((enter) => {
        const w = enter.append("g").attr("class", "cal-weekday is-link").attr("role", "button");
        w.append("rect").attr("class", "cal-weekday__hit");
        w.append("text").attr("class", "cal-label").attr("text-anchor", "end").attr("dy", "0.35em");
        w.append("title");
        return w;
      })
      .on("click", (event, d) => selectWeekday(d.i));
    weekdays.select("rect").attr("x", -12).attr("y", (d) => d.i * cell).attr("width", 11).attr("height", cell);
    weekdays.select("text").attr("x", -3).attr("y", (d) => (d.i + 0.5) * cell)
      .style("font-size", `${Math.min(10, cell + 1)}px`).text((d) => d.letter);
    weekdays.select("title").text((d) => `Select all ${WEEKDAY_NAMES[d.i]}`);

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

  function selectWeekday(i) {
    const same = weekdaySel === i && last?.selectionSource === `${NAME}:weekday`;
    weekdaySel = same ? null : i;
    const ids = same ? null : allDays.filter((d) => d.row && d.weekday === i).map((d) => d.id);
    dispatcher.call("brushPoints", null, { ids, source: `${NAME}:weekday` });
  }

  function applySelection(state) {
    yearsG.selectAll(".cal-cell")
      .classed("is-dimmed", (d) => d.row && !inPeriod(state, d.row))
      .classed("is-selected", (d) => Boolean(d.row && state.selectedIds?.has(d.id) && inPeriod(state, d.row)));
    yearsG.selectAll(".cal-cell.is-selected").raise();
    yearsG.selectAll(".cal-year__label").classed("is-active", (y) => sameRange(yearRange(y.year), state.zoom));
    yearsG.selectAll(".cal-weekday").classed("is-active",
      (d) => state.selectionSource === `${NAME}:weekday` && d.i === weekdaySel);
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

  const selectRange = (a, b) => {
    const [from, to] = a.date <= b.date ? [a.date, b.date] : [b.date, a.date];
    const ids = allDays.filter((d) => d.row && d.date >= from && d.date <= to).map((d) => d.id);
    dispatcher.call("brushPoints", null, { ids, source: NAME });
  };

  const cellDatum = (event) => (event.target.classList.contains("cal-cell") ? d3.select(event.target).datum() : null);

  yearsG
    .on("pointerdown", (event) => {
      const d = cellDatum(event);
      if (!d?.row) return;
      event.preventDefault(); 
      anchor = d;
      dragged = false;
      tooltip.hide();
    })
    .on("pointerover", (event) => {
      const d = cellDatum(event);
      if (!d) return;
      if (anchor) {
        if (d.row && d !== anchor) { dragged = true; selectRange(anchor, d); }
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
    if (!dragged) {
      const only = last?.selectionSource === NAME && last.selectedIds?.size === 1 && last.selectedIds.has(anchor.id);
      dispatcher.call("brushPoints", null, { ids: only ? null : [anchor.id], source: NAME });
    }
    anchor = null;
  });

  return {
    update(state, reason) {
      last = state;
      if (reason === "hover") return applyHover(state);
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
