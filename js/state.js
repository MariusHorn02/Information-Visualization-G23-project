export const state = {
  zoom: null,         
  timeRange: null,    
  selectedIds: null,    
  selectionSource: null, 
  // Legend filters, one per legend: { source: Set of day ids }. Kept apart from
  // the selection and from each other so they all combine, e.g. Heavy rain in
  // the calendar AND Winter in the scatterplot AND a marked period.
  filters: {},
  hoveredId: null,       
  encodings: {         
    scatter: { x: "rain_mm", y: "bike_trips", color: "season" },
    calendar: { measure: "bike_trips" },
  },
};

export const dispatcher = d3.dispatch("zoomTime", "brushTime", "brushPoints", "filter", "hover", "encode", "reset", "change");

const notify = (reason) => dispatcher.call("change", null, state, reason);


dispatcher.on("zoomTime.state", (range) => {
  state.zoom = range;
  state.timeRange = null; 
  notify("zoomTime");
});

dispatcher.on("brushTime.state", (range) => {
  state.timeRange = range;
  notify("brushTime");
});

dispatcher.on("brushPoints.state", ({ ids, source }) => {
  state.selectedIds = ids ? new Set(ids) : null;
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

dispatcher.on("filter.state", ({ ids, source }) => {
  if (ids) state.filters[source] = new Set(ids);
  else delete state.filters[source];
  notify("filter");
});

dispatcher.on("reset.state", () => {
  state.zoom = null;
  state.timeRange = null;
  state.selectedIds = null;
  state.selectionSource = null;
  state.filters = {};
  state.hoveredId = null;
  notify("reset");
});

export function register(name, chart) {
  dispatcher.on(`change.${name}`, (s, reason) => chart.update(s, reason));
}

const inRange = (range, date) => !range || (date >= range[0] && date <= range[1]);

export const inPeriod = (s, d) => inRange(s.zoom, d.date) && inRange(s.timeRange, d.date);

/** Passes the day selection and every legend filter (ignores the period). */
export const isPicked = (s, id) =>
  (!s.selectedIds || s.selectedIds.has(id)) && Object.values(s.filters).every((ids) => ids.has(id));

export const hasPick = (s) => Boolean(s.selectedIds || Object.keys(s.filters).length);

export const isActive = (s, d) => inPeriod(s, d) && isPicked(s, d.id);

export const hasFilter = (s) => Boolean(s.zoom || s.timeRange || hasPick(s));
