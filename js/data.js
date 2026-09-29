// data.js — loads the CSV once and prepares one data structure per idiom.
// Every row gets `id` = its ISO date. All views show days, so this id is the
// shared key that links them: a selection is simply a set of ids.

const DATA_URL = "data/bergen_daily_clean.csv";

/** Quantitative attributes: labels, units and number formats shared by all charts. */
export const ATTRIBUTES = {
  rain_mm: {
    label: "Rain", unit: "mm", format: ".1f",
    // 524 of 1,629 days are dry (0 mm); the scatterplot jitters them to avoid occlusion.
    jitterZero: true,
  },
  bike_trips:            { label: "Bike trips",         unit: "trips/day",    format: ",d" },
  bike_avg_duration_min: { label: "Avg. trip duration", unit: "min",          format: ".1f" },
  traffic_count:         { label: "Car traffic",        unit: "vehicles/day", format: ",d" },
  no2_ug_m3:             { label: "NO₂",                unit: "µg/m³",        format: ".1f" },
  temp_c:                { label: "Temperature",        unit: "°C",           format: ".1f" },
};

export const attrLabel = (key) => `${ATTRIBUTES[key].label} (${ATTRIBUTES[key].unit})`;
export const formatValue = (key, v) =>
  Number.isFinite(v) ? `${d3.format(ATTRIBUTES[key].format)(v)} ${ATTRIBUTES[key].unit}` : "missing";

// Empty cells are missing measurements: NaN, never 0 (`+""` would give 0).
const num = (v) => (v === "" || v == null ? NaN : +v);

export async function loadData() {
  const parseDate = d3.utcParse("%Y-%m-%d");
  const rows = await d3.csv(DATA_URL, (d) => {
    const date = parseDate(d.date);
    const isWeekend = d.is_weekend === "True";
    return {
      id: d.date,
      date,
      year: date.getUTCFullYear(),
      rain_mm: num(d.rain_mm),
      temp_c: num(d.temp_c),
      bike_trips: num(d.bike_trips),
      bike_avg_duration_min: num(d.bike_avg_duration_min),
      traffic_count: num(d.traffic_count),
      no2_ug_m3: num(d.no2_ug_m3),
      month: d.month,
      season: d.season,
      is_weekend: isWeekend,
      day_type: isWeekend ? "Weekend" : "Weekday",
      rain_category: d.rain_category,
    };
  });
  return rows;
}

/**
 * Scatterplot data: one point per day. No weekly means or bins: rain acts on
 * single days, and single days must stay hoverable and linkable to the calendar.
 */
export function getScatterData(rows) {
  return rows;
}

/**
 * Pearson correlation r between two attributes: −1 (perfect negative) … +1
 * (perfect positive), 0 = no linear relation. Null when too few points or when
 * one attribute has no spread (e.g. all dry days have 0 mm rain).
 */
export function correlation(points, xKey, yKey) {
  const n = points.length;
  if (n < 3) return null;
  const mx = d3.mean(points, (d) => d[xKey]);
  const my = d3.mean(points, (d) => d[yKey]);
  let sxy = 0, sxx = 0, syy = 0;
  for (const d of points) {
    const dx = d[xKey] - mx, dy = d[yKey] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Temperature sits under bike trips so the two yearly cycles compare by eye (Task 4).
export const HORIZON_MEASURES = ["bike_trips", "temp_c", "traffic_count", "no2_ug_m3"];
export const SMOOTH_WINDOW = 7;  // days, centred
const SMOOTH_MIN_VALID = 4;      // measured days needed in a window, else a gap
const HORIZON_BANDS = 3;

/** Centred rolling mean that skips NaN; NaN when fewer than `minValid` values. */
function rollingMean(values, window, minValid) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1).filter(Number.isFinite);
    return slice.length >= minValid ? d3.mean(slice) : NaN;
  });
}

function niceStep(x, relative) {
  return relative ? Math.ceil(x * 20) / 20 : Math.ceil(x);
}

/**
 * Horizon data, per measure: the 7-day centred mean as deviation from that
 * measure's own 2021–2025 mean, so trips, vehicles and µg/m³ share one
 * above/below scale without a distorted shared axis. Relative (%) for counts
 * and NO₂, absolute (°C) for temperature, where a percentage is meaningless.
 * Band size = max |deviation| / 3. Days without a measurement stay NaN (gaps).
 */
export function getHorizonData(rows) {
  const half = Math.floor(SMOOTH_WINDOW / 2);
  return HORIZON_MEASURES.map((key) => {
    const relative = key !== "temp_c";
    const raw = rows.map((d) => d[key]);
    const smooth = rollingMean(raw, SMOOTH_WINDOW, SMOOTH_MIN_VALID)
      .map((v, i) => (Number.isFinite(raw[i]) ? v : NaN));
    const mean = d3.mean(raw);
    const values = rows.map((d, i) => ({
      id: d.id,
      date: d.date,
      raw: raw[i],
      smooth: smooth[i],
      dev: relative ? smooth[i] / mean - 1 : smooth[i] - mean,
      from: rows[Math.max(0, i - half)].date, // window range, shown in the tooltip
      to: rows[Math.min(rows.length - 1, i + half)].date,
    }));
    const maxAbs = d3.max(values, (v) => Math.abs(v.dev));
    const step = niceStep(maxAbs / HORIZON_BANDS, relative);
    return {
      key, label: ATTRIBUTES[key].label, relative, mean, step,
      bands: HORIZON_BANDS, window: SMOOTH_WINDOW, values,
    };
  });
}

/**
 * Calendar data: every day of each year, column = Monday-first week of the
 * year, row = weekday (0 = Monday). Days outside the dataset get `row = null`
 * and are drawn as "no data", not as zero.
 */
export function getCalendarData(rows) {
  const byId = new Map(rows.map((d) => [d.id, d]));
  const fmt = d3.utcFormat("%Y-%m-%d");
  const [first, last] = d3.extent(rows, (d) => d.year);
  return d3.range(first, last + 1).map((year) => {
    const start = new Date(Date.UTC(year, 0, 1));
    const days = d3.utcDays(start, new Date(Date.UTC(year + 1, 0, 1))).map((date) => {
      const id = fmt(date);
      return {
        id,
        date,
        week: d3.utcMonday.count(start, date),
        weekday: (date.getUTCDay() + 6) % 7,
        row: byId.get(id) ?? null,
      };
    });
    return { year, days };
  });
}
