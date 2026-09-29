// theme.js — reads the colour tokens from css/style.css :root into d3 scales.
// Colours are defined once, in CSS, so all idioms share one palette.

const rootStyle = () => getComputedStyle(document.documentElement);

export function cssVar(name) {
  return rootStyle().getPropertyValue(name).trim();
}

export const transitionMs = () => +cssVar("--transition-ms") || 750;
export const dotRadius = () => +cssVar("--dot-radius") || 3.5;

/**
 * Colour encodings shared by all charts. Categorical/ordinal: one CSS colour
 * per value (hue for categories, lightness order for ordered values).
 * Sequential: a continuous ramp through the CSS colour stops.
 */
export const COLOR_ENCODINGS = {
  season: {
    label: "Season",
    type: "categorical",
    field: "season",
    domain: ["Winter", "Spring", "Summer", "Autumn"],
    vars: ["--season-winter", "--season-spring", "--season-summer", "--season-autumn"],
  },
  rain_category: {
    label: "Rain category",
    type: "ordinal",
    field: "rain_category",
    domain: ["Dry", "Light", "Moderate", "Heavy"],
    vars: ["--rain-dry", "--rain-light", "--rain-moderate", "--rain-heavy"],
    note: "Dry 0 · Light <5 · Moderate 5–20 · Heavy ≥20 mm",
  },
  day_type: {
    label: "Weekday / weekend",
    type: "categorical",
    field: "day_type",
    domain: ["Weekday", "Weekend"],
    vars: ["--daytype-weekday", "--daytype-weekend"],
  },
  temp_c: {
    label: "Temperature",
    type: "sequential",
    field: "temp_c",
    unit: "°C",
    vars: ["--temp-0", "--temp-1", "--temp-2", "--temp-3", "--temp-4"],
  },
  bike_trips: {
    label: "Bike trips",
    type: "sequential",
    field: "bike_trips",
    unit: "trips/day",
    vars: ["--bike-0", "--bike-1", "--bike-2", "--bike-3", "--bike-4"],
  },
  year: {
    label: "Year",
    type: "ordinal",
    field: "year",
    domain: [2021, 2022, 2023, 2024, 2025],
    vars: ["--year-2021", "--year-2022", "--year-2023", "--year-2024", "--year-2025"],
  },
  traffic_count: {
    label: "Car traffic",
    type: "sequential",
    field: "traffic_count",
    unit: "vehicles/day",
    vars: ["--traffic-0", "--traffic-1", "--traffic-2", "--traffic-3", "--traffic-4"],
  },
  // A few event days reach 35 min: the ramp ends at the 95th percentile so
  // they don't wash out the rest; longer days get the darkest colour.
  bike_avg_duration_min: {
    label: "Trip duration",
    type: "sequential",
    field: "bike_avg_duration_min",
    unit: "min",
    clipQuantile: 0.95,
    vars: ["--duration-0", "--duration-1", "--duration-2", "--duration-3", "--duration-4"],
  },
};

/** Horizon band colours, lightest → darkest. */
export function horizonColors() {
  return {
    above: ["--hz-above-1", "--hz-above-2", "--hz-above-3"].map(cssVar),
    below: ["--hz-below-1", "--hz-below-2", "--hz-below-3"].map(cssVar),
    dimmed: ["--hz-dimmed-1", "--hz-dimmed-2", "--hz-dimmed-3"].map(cssVar),
  };
}

/** d3 colour scale for an encoding; sequential domains come from the data (`values`). */
export function colorScale(key, values = []) {
  const enc = COLOR_ENCODINGS[key];
  const colors = enc.vars.map(cssVar);
  if (enc.type === "sequential") {
    const get = (d) => d?.[enc.field];
    const [lo, max] = d3.extent(values, get);
    const hi = enc.clipQuantile ? d3.quantile(values, enc.clipQuantile, get) : max;
    return d3.scaleSequential(d3.interpolateRgbBasis(colors)).domain([lo, hi]).clamp(true);
  }
  return d3.scaleOrdinal().domain(enc.domain).range(colors);
}
