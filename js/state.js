// state.js — the shared state of the dashboard and the event bus that links the charts.
//
//   chart ──(intent event)──▶ dispatcher ──▶ state.js updates `state`
//                                                  │
//   every chart.update(state, reason) ◀──"change"──┘
//
// Charts never call each other: they emit intents and redraw from the state.
// A new chart links to all others just by listening to "change".

export const state = {
  zoom: null,            // [Date, Date] period in focus (a year or a zoomed brush), null = all years
  timeRange: null,       // [Date, Date] period brushed in the horizon chart
  selectedIds: null,     // Set of selected day ids, from any view
  selectionSource: null, // chart that made the selection (keeps its own brush visible)
  hoveredId: null,       // day under the pointer in any view
  encodings: {           // view settings, kept by Reset
    scatter: { x: "rain_mm", y: "bike_trips", color: "season" },
    calendar: { measure: "bike_trips" },
  },
};

/**
 * Intents (from charts / UI):
 *   zoomTime    ([Date, Date] | null)
 *   brushTime   ([Date, Date] | null)
 *   brushPoints ({ ids: string[] | null, source })
 *   hover       (id | null)
 *   encode      ({ chart, ...encoding }), e.g. { chart: "scatter", x: "temp_c" }
 *   reset       ()
 * Output (to charts):
 *   change      (state, reason)   reason = the intent that caused it
 */
export const dispatcher = d3.dispatch("zoomTime", "brushTime", "brushPoints", "hover", "encode", "reset", "change");

const notify = (reason) => dispatcher.call("change", null, state, reason);

// The ".state" namespace lets other listeners share these event types.
dispatcher.on("zoomTime.state", (range) => {
  state.zoom = range;
  state.timeRange = null; // the old brush was drawn on the old time axis
  notify("zoomTime");
});

dispatcher.on("brushTime.state", (range) => {
  state.timeRange = range;
  notify("brushTime");
});

dispatcher.on("brushPoints.state", ({ ids, source }) => {
  state.selectedIds = ids ? new Set(ids) : null; // [] is a real, empty selection
  state.selectionSource = state.selectedIds ? source : null;
  notify("brushPoints");
});

dispatcher.on("hover.state", (id) => {
  if (state.hoveredId === id) return;
  state.hoveredId = id;
  notify("hover");
});

dispatcher.on("encode.state", ({ chart, ...encoding }) => {
  Object.assign(state.encodings[chart], encoding);
  notify("encode");
});

dispatcher.on("reset.state", () => {
  state.zoom = null;
  state.timeRange = null;
  state.selectedIds = null;
  state.selectionSource = null;
  state.hoveredId = null;
  notify("reset");
});

/** Subscribe a chart: it then receives chart.update(state, reason) on every change. */
export function register(name, chart) {
  dispatcher.on(`change.${name}`, (s, reason) => chart.update(s, reason));
}

const inRange = (range, date) => !range || (date >= range[0] && date <= range[1]);

/** Is the day inside the chosen period (zoom AND brushed range)? */
export const inPeriod = (s, d) => inRange(s.zoom, d.date) && inRange(s.timeRange, d.date);

/** The one filter rule every chart applies: in the period AND in the selection. */
export function isActive(s, d) {
  if (!inPeriod(s, d)) return false;
  if (s.selectedIds && !s.selectedIds.has(d.id)) return false;
  return true;
}

export const hasFilter = (s) => Boolean(s.zoom || s.timeRange || s.selectedIds);
