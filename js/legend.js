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
      return counts ? `Select all ${n(v)} ${v}${range} days` : `Select ${v}${range} days`;
    })
    .on("click", (event, v) => onSelect?.(v));
  items.append("span").attr("class", "legend__swatch").style("background", (v) => scale(v));
  items.append("span").text((v) => v);
  if (showCounts) items.append("span").attr("class", "legend__count").text((v) => d3.format(",")(n(v)));
  if (extra) items.filter((v) => extra(v) != null).append("span").attr("class", "legend__extra").text(extra);
}

export function markLegend(legend, value) {
  legend.selectAll(".legend__item").classed("is-active", (v) => v === value);
}

export function legendSelector(dispatcher, source, getRows, getField) {
  let value = null;
  return {
    select(v, state) {
      const same = value === v && state?.filterSource === source;
      value = same ? null : v;
      const field = getField();
      const ids = same ? null : getRows().filter((d) => d[field] === v).map((d) => d.id);
      dispatcher.call("filter", null, { ids, source });
    },
    active(state) {
      return state?.filterSource === source ? value : null;
    },
  };
}
