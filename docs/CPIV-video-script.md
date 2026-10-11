# CPIV-23 — video script (max 3:00)

**File names:** video `CPIV-23.mp4` (H.264), zip `CPIV-23.zip` (video + code + dataset). Use the same number in both names; mismatched names cost 0.5 points.
**Baseline:** Checkpoint III = commit `2e03fe8` (29 Sep). The brief asks for **only the deltas** since then, each one **justified** (principles + VisDeck).
**Pace:** ~150 words per minute. The narration is ~394 words, about 2:38, which leaves room for the live clicks. Rehearse with a stopwatch: every extra 10 s costs 1 grade point.

> **Before recording:** fill in the `[VisDeck: …]` placeholders with the card names from your own spread, and say them out loud. The brief penalises changes that aren't justified.

---

## Timeline

| Time | Section (grading weight) | On screen |
|---|---|---|
| 0:00–0:12 | Intro + full interface | Whole dashboard, nothing selected |
| 0:12–0:35 | Architecture (5 %) | `docs/flowchart.svg`, then `js/zoom.js`, `js/state.js` |
| 0:35–0:48 | Layout (5 %) | CP III screenshot vs now |
| 0:48–1:08 | Data processing (5 %) | `d3.group` in `calendar.js`, `focusRuns` in `horizon.js` |
| 1:08–1:58 | Visualization + interaction (25 % + 20 %) | Live demo |
| 1:58–2:45 | Integration (30 %) | Live demo, then `isActive` + `CHARTS` |
| 2:45–3:00 | Wrap-up | Full interface |

---

## 0:00–0:12 · Intro + full interface
**Screen:** the full dashboard. Keep the mouse still.

> "This is Group 23's prototype on rain and mobility in Bergen: a horizon chart, a scatterplot and a calendar, all linked. Here is what changed since Checkpoint III, and why."

## 0:12–0:35 · Code architecture (deltas)
**Screen:** the flowchart, then `zoom.js` and `state.js`.

> "Three changes. A new shared module, `zoom.js`, gives every chart the same zoom and pan, and replaces the old full-screen module. The shared state got a second channel, a legend *filter*, kept separate from the *selection*. And `main.js` now loads data and chart modules in parallel and draws each chart once, which fixed a slow start."

## 0:35–0:48 · Layout (deltas)
**Screen:** CP III screenshot next to the current dashboard.

> "We removed subtitles and expand buttons and halved the gaps, so the charts get more space. Help text moved into tooltips. [VisDeck: …]"

## 0:48–1:08 · Additional data processing (deltas)
**Screen:** the `d3.group` lines in `calendar.js`, then `focusRuns()` in `horizon.js`.

> "New runtime processing: the calendar groups all days by month, weekday and year, so one click selects a whole group. The horizon chart merges selected days into continuous runs to draw them, and computes each strip's average. Counts and correlations are recalculated for the current period."

## 1:08–1:58 · Visualization + interaction (deltas)
**Screen:** live. Do each action as you say it.

1. Scroll on the scatterplot, Shift+drag, then click **Reset zoom**.
   > "Every chart now zooms with the scroll wheel and pans with Shift+drag; a plain drag still selects."
2. **Alt+drag** a period in the horizon chart.
   > "Alt+drag marks a period and zooms into it, and it stays marked: overview first, zoom and filter, details on demand."
3. Point at the legend, then click **Temperature** on the left.
   > "The legend now reads *slightly, clearly, far* above or below average. Clicking a strip shows it alone, and the legend switches to its real ranges, here in degrees."
4. In the scatterplot, switch Category to **Year**, then back to **Season**.
   > "Orange and blue mean above and below average, so the seasons now use cyan, yellow, red and purple, and the years viridis: hue for categories, lightness for order, checked to be colour-blind safe. [VisDeck: …]"

## 1:58–2:45 · Integration (deltas)
**Screen:** live, then the code.

1. Click Reset. In the calendar, click **J**, **J**, **A** (June, July, August).
   > "The calendar now supports multi-select: every click adds a day, a month, a weekday or a year, and clicking again removes it. Here: all summer months."
2. In the scatterplot, set Category to **Weekday / weekend** and click **Weekend** in its legend.
   > "Filters combine instead of replacing each other: summer months *and* weekends. All three views agree, and everything else turns grey, now including the horizon chart."
3. Show `isActive()` in `state.js`.
   > "That works because of one shared rule: a day must be in the period, the selection *and* the legend filter. Every chart calls it, and zoom stays local, so it never filters other views."
4. Show the `CHARTS` list in `main.js`.
   > "Adding an idiom is still one line here plus an update function. Charts only talk to the shared state, never to each other, so a new chart gets linking for free."

## 2:45–3:00 · Wrap-up
**Screen:** full interface. Click Reset.

> "In short: more room for data, zoom everywhere, multi-select in the calendar, filters that combine, and colours with one meaning each. Thank you."

---

## Justification cheat-sheet (if you're asked to defend a change)

| Change | Principle |
|---|---|
| Zoom / pan / Alt+drag mark-and-zoom | Shneiderman: overview first, zoom and filter, details on demand |
| Calendar multi-select (days, months, weekdays, years) | Flexible grouping matched to the tasks (seasons, weekends, years); direct manipulation |
| Filters intersect (period AND selection AND legend) | Brushing and linking; consistent filtering across views |
| Unselected days greyed out in all views | Pre-attentive pop-out of the selection; the same encoding in every view |
| Show one strip only, with its real ranges | Focus + context; meaningful units on demand |
| Legend in words + Above/Below avg. | Less mental conversion; one legend valid for four strips with different scales |
| New season colours; viridis for years | Hue for categorical data, lightness for ordered data; separability; colour-blind safety; one colour = one meaning |
| Fixed-width legend numbers | Stable layout, no change blindness when values update |
| No subtitles, smaller gaps, compact tooltips | Data-ink ratio: more space for data |
| Faster start-up | Responsiveness: interaction latency matters |
