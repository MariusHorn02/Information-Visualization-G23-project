import * as Data from "./data.js";
import { state, dispatcher, register, isActive, hasFilter } from "./state.js";

const CHARTS = [
  { id: "horizon",  module: "./charts/horizon.js",  prepare: Data.getHorizonData },
  { id: "scatter",  module: "./charts/scatter.js",  prepare: Data.getScatterData },
  { id: "calendar", module: "./charts/calendar.js", prepare: Data.getCalendarData },
];

async function init() {
  // Load data and chart modules in parallel, then build every panel before
  // drawing, so earlier charts aren't re-laid-out as later ones appear.
  const [rows, modules] = await Promise.all([
    Data.loadData(),
    Promise.all(CHARTS.map(({ module }) => import(module))),
  ]);

  const charts = CHARTS.map(({ id, prepare }, i) => {
    const container = document.querySelector(`[data-chart="${id}"]`);
    const chart = modules[i].create(container, prepare(rows), dispatcher);
    register(id, chart);
    return { container, chart };
  });

  charts.forEach(({ chart }) => chart.update(state, "init"));
  charts.forEach(({ container, chart }) => observeSize(container, chart));

  wireGlobalUi(rows);
}

function observeSize(container, chart) {
  const targets = [container, ...container.querySelectorAll(".chart-area")];
  const sizeKey = () => targets.map((el) => `${el.clientWidth}x${el.clientHeight}`).join(",");
  let frame = null;
  // Start empty: a chart measures itself before its legend and notes exist, so
  // the size it was drawn at may already be stale. The observer's first
  // callback then redraws it once at the settled size.
  let lastSize = "";
  const observer = new ResizeObserver(() => {
    const size = sizeKey();
    if (size === lastSize) return;
    lastSize = size;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => chart.resize());
  });
  targets.forEach((el) => observer.observe(el));
}

function wireGlobalUi(rows) {
  d3.select("#reset-btn").on("click", () => dispatcher.call("reset"));

  const status = d3.select("#selection-status");
  const fmt = d3.utcFormat("%-d %b %Y");
  dispatcher.on("change.status", (s, reason) => {
    if (reason === "hover") return;
    if (!hasFilter(s)) return status.text("");
    const parts = [];
    const period = s.timeRange ?? s.zoom;
    if (period) parts.push(`${fmt(period[0])} – ${fmt(period[1])}`);
    const n = rows.filter((d) => isActive(s, d)).length;
    parts.push(`${n} of ${rows.length} days selected`);
    status.text(parts.join(" · "));
  });
}

init().catch((err) => {
  console.error(err);
  d3.select(".dashboard").insert("p", ":first-child")
    .text(`Could not load the dashboard: ${err.message}. Run it through a local server (see README).`);
});
