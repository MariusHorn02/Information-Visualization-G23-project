import { ATTRIBUTES, formatValue } from "./data.js";

const OFFSET = 14;
let el = null;

export const fmtDate = d3.utcFormat("%a %-d %b %Y");

function node() {
  if (!el) el = d3.select("body").append("div").attr("class", "tooltip").attr("role", "tooltip");
  return el;
}

export function show(html, event) {
  node().html(html).classed("is-visible", true);
  move(event);
}

export function move(event) {
  const tip = node().node();
  const { width, height } = tip.getBoundingClientRect();
  // Flip to the other side of the pointer near the window edges.
  let x = event.clientX + OFFSET;
  let y = event.clientY + OFFSET;
  if (x + width > window.innerWidth - 4) x = event.clientX - OFFSET - width;
  if (y + height > window.innerHeight - 4) y = event.clientY - OFFSET - height;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}

export function hide() {
  if (el) el.classed("is-visible", false);
}


 // Standard tooltip for one day row, used by every chart that shows days.

export function dayHtml(d, highlight = []) {
  const bold = new Set(highlight);
  const rows = Object.keys(ATTRIBUTES).map((k) =>
    `<tr class="${bold.has(k) ? "is-encoded" : ""}"><td>${ATTRIBUTES[k].label}</td><td>${formatValue(k, d[k])}</td></tr>`);
  return `<h3>${fmtDate(d.date)}</h3>
    <div class="muted">${d.season} · ${d.day_type} · ${d.rain_category} rain</div>
    <table>${rows.join("")}</table>`;
}
