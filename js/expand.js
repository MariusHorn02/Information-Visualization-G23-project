// expand.js — lets any panel fill the browser window (button or double-click
// on its header; Esc or a click outside closes it). Charts need no extra code:
// the resize observer in main.js redraws them at the new size.

const ICONS = `
  <svg class="icon-expand" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 2h4v4M6 14H2v-4M14 2 9.5 6.5M2 14l4.5-4.5"/>
  </svg>
  <svg class="icon-collapse" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14"/>
  </svg>`;

let expanded = null;
let backdrop = null;

function setExpanded(panel, on) {
  if (on && expanded && expanded !== panel) setExpanded(expanded, false);
  panel.classList.toggle("is-expanded", on);
  document.body.classList.toggle("has-expanded", on);
  const btn = panel.querySelector(".icon-btn");
  const title = panel.querySelector("h2")?.textContent ?? "chart";
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", `${on ? "Exit full screen" : "Expand"}: ${title}`);
  btn.title = on ? "Exit full screen (Esc)" : "Expand to full screen";
  if (on) {
    backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    backdrop.addEventListener("click", () => setExpanded(panel, false));
    panel.before(backdrop);
    expanded = panel;
  } else {
    backdrop?.remove();
    backdrop = null;
    expanded = null;
  }
}

export function makeExpandable(panel) {
  const head = panel.querySelector(".panel__head");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.innerHTML = ICONS;
  head.append(btn);

  const toggle = () => setExpanded(panel, !panel.classList.contains("is-expanded"));
  btn.addEventListener("click", toggle);
  head.addEventListener("dblclick", (event) => {
    if (event.target.closest("button, select")) return;
    toggle();
  });
  setExpanded(panel, false);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && expanded) setExpanded(expanded, false);
});
