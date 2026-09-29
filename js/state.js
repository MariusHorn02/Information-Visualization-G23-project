export const state = {
  zoom: null,         
  timeRange: null,    
  selectedIds: null,    
  selectionSource: null, 
  hoveredId: null,       
  encodings: {         
    scatter: { x: "rain_mm", y: "bike_trips", color: "season" },
    calendar: { measure: "bike_trips" },
  },
};

export const dispatcher = d3.dispatch("zoomTime", "brushTime", "brushPoints", "hover", "encode", "reset", "change");

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

dispatcher.on("reset.state", () => {
  state.zoom = null;
  state.timeRange = null;
  state.selectedIds = null;
  state.selectionSource = null;
  state.hoveredId = null;
  notify("reset");
});

export function register(name, chart) {
  dispatcher.on(`change.${name}`, (s, reason) => chart.update(s, reason));
}

const inRange = (range, date) => !range || (date >= range[0] && date <= range[1]);

export const inPeriod = (s, d) => inRange(s.zoom, d.date) && inRange(s.timeRange, d.date);

export function isActive(s, d) {
  if (!inPeriod(s, d)) return false;
  if (s.selectedIds && !s.selectedIds.has(d.id)) return false;
  return true;
}

export const hasFilter = (s) => Boolean(s.zoom || s.timeRange || s.selectedIds);
