import { COLOR_ENCODINGS } from "./theme.js";


export function renderLegend(legend, key, scale, { counts, showCounts = false, extra, onSelect } = {}) {
  const ce = COLOR_ENCODINGS[key];
  legend.selectAll("*").remove();

  if (ce.type === "sequential") {
    const [lo, hi] = scale.domain();
    const stops = d3.range(0, 1.0001, 0.1).map((t) => scale(lo + t * (hi - lo)));
    const fmt = d3.format(hi - lo > 100 ? ",.0f" : ".0f");
    legend.append("span").text(`${ce.label} (${ce.unit})`);
    legend.append("span").text(fmt(lo));
    legend.append("span").attr("class", "legend__ramp")
      .style("background", `linear-gradient(to right, ${stops.join(",")})`);
    legend.append("span").text(ce.clipQuantile ? `≥ ${fmt(hi)}` : fmt(hi));
    return;
  }

  const n = (v) => counts?.get(v) ?? 0;
  const items = legend.selectAll("button")
    .data(ce.domain)
    .join("button")
    .attr("type", "button")
    .attr("class", "legend__item")
    .attr("title", (v) => {
      const range = ce.ranges?.[v] ? ` (${ce.ranges[v]})` : "";
      const what = counts ? `all ${n(v)} ${v}${range} days` : `${v}${range} days`;
      return `Click to add or remove ${what}. Click more categories to combine them.`;
    })
    .on("click", (event, v) => onSelect?.(v));
  items.append("span").attr("class", "legend__swatch").style("background", (v) => scale(v));
  items.append("span").text((v) => v);
  if (showCounts) items.append("span").attr("class", "legend__count").text((v) => d3.format(",")(n(v)));
  if (extra) items.filter((v) => extra(v) != null).append("span").attr("class", "legend__extra").text(extra);
}

export function markLegend(legend, values) {
  legend.selectAll(".legend__item").classed("is-active", (v) => Boolean(values?.has(v)));
}

/** Legend filter with multi-select: every click adds a category (e.g. Spring,
 *  then Winter), clicking a selected one again removes it, and removing the
 *  last one clears the filter. */
export function legendSelector(dispatcher, source, getRows, getField) {
  let values = new Set();
  let valuesField = null;
  return {
    select(v, state) {
      const field = getField();
      // Start over if another view set the filter or the legend switched attribute.
      if (state?.filterSource !== source || valuesField !== field) values = new Set();
      valuesField = field;
      if (values.has(v)) values.delete(v);
      else values.add(v);
      const ids = values.size ? getRows().filter((d) => values.has(d[field])).map((d) => d.id) : null;
      dispatcher.call("filter", null, { ids, source });
    },
    active(state) {
      return state?.filterSource === source && valuesField === getField() ? values : null;
    },
  };
}
