// main.js — entry point: loads the data once, then mounts every chart in CHARTS.
//
// Every chart module has the same interface:
//   create(container, data, dispatcher) → { update(state, reason), resize() }
// Adding an idiom = one new file in js/charts/ + one line in CHARTS.

import * as Data from "./data.js";
import { state, dispatcher, register, isActive, hasFilter } from "./state.js";
import { makeExpandable } from "./expand.js";

const CHARTS = [
  { id: "horizon",  module: "./charts/horizon.js",  prepare: Data.getHorizonData },
  { id: "scatter",  module: "./charts/scatter.js",  prepare: Data.getScatterData },
  { id: "calendar", module: "./charts/calendar.js", prepare: Data.getCalendarData },
];

async function init() {
  const rows = await Data.loadData();

  for (const { id, module, prepare } of CHARTS) {
    const container = document.querySelector(`[data-chart="${id}"]`);
    const { create } = await import(module);
    const chart = create(container, prepare(rows), dispatcher);
    register(id, chart);
    chart.update(state, "init");
    observeSize(container, chart);
    makeExpandable(container.closest(".panel"));
  }

  wireGlobalUi(rows);
}

// Redraw a chart when its drawing area changes size: window resize, full
// screen, or its own legend wrapping onto a second line.
function observeSize(container, chart) {
  const targets = [container, ...container.querySelectorAll(".chart-area")];
  let frame = null;
  let lastSize = "";
  const observer = new ResizeObserver(() => {
    const size = targets.map((el) => `${el.clientWidth}x${el.clientHeight}`).join(",");
    if (size === lastSize) return;
    lastSize = size;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => chart.resize());
  });
  targets.forEach((el) => observer.observe(el));
}

function wireGlobalUi(rows) {
  d3.select("#reset-btn").on("click", () => dispatcher.call("reset"));

  // The header status listens to "change" like any chart.
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
