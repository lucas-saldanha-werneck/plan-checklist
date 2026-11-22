# Changelog

Versions are the `version` in `.claude-plugin/plugin.json`. Newest first.

## 0.4.1 (2026-11-22)
- Fix: when side-stack loads late, the own pane no longer stays open as a separate tab. The host is looked for again at 5 s, 15 s and 60 s (stack-guest.tsx, byte-identical copy of side-stack 0.5.2); if the own pane renders while stacked it now closes itself.

## 0.4.0 (2026-11-18)

- The heading carries the time (`Plan 1/3 · 2m 5s`, `Plan · done · 1m 2s`); the line repeating your prompt is gone.
- Rows have no labels: ✓ done, ▶ working (‖ paused), ○ to do. Only the working step has a bar: the surface's own progress bar on 2.1.327+, a text bar before. Theme colors.
- `Plan · paused` shows one dim line, "Claude stopped before the last step"; Esc shows "Stopped with Esc".
- Whether the Stack pane is open is asked of `$.ui.panes()`; `/checklist` answers "Stack pane opened."
- The side-stack guest protocol now comes from `hooks/stack-guest.tsx`, a byte-identical copy of side-stack's (CI checks it).
- Rendering split by surface: one look for the terminal, one for the apps (desktop, mobile, VS Code). Both draw the same tree for now.

## 0.3.12 (2026-11-18)

- Draw in the side-stack pane again on Claude Code 2.1.327 and later, which hears only a plugin's own drawings unless the hook names `plugin: '*'`. Older builds keep working (the hook is registered both ways and the section is drawn once).

## 0.3.11 (2026-11-13)

- README: add an Examples section.

## 0.3.10 (2026-11-12)

- Headless `claude -p` prompts run ungated.

## 0.3.9 (2026-11-12)

- Gate only a person's request; bring the Stack pane forward silently.

## 0.3.8 (2026-11-12)

- Allow starting a subagent before the plan.

## 0.3.7 (2026-11-12)

- A prompt after a paused plan starts a new plan; a new plan after All done shows as work in progress.
- A TodoWrite counts only after the tool accepted it, with at least one item.
- A step reopened with TaskUpdate starts again from 0%.

## 0.3.6 (2026-11-11)

- Do not run /stack before the first prompt when a phone is attached.

## 0.3.5 (2026-11-11)

- Point to the catalog repo's new name, `lucas-tools`.

## 0.3.4 (2026-11-11)

- Catalog renamed to `lucas-tools`.

## 0.3.3 (2026-11-11)

- Headless runs never run /stack.

## 0.3.2 (2026-11-11)

- Do not run /stack for a plan started from Remote Control.

## 0.3.1 (2026-11-09)

- One-line description, catalog install steps, README headings.

## 0.3.0 (2026-11-09)

- Side-stack section order (protocol v4).

## 0.2.1 (2026-11-09)

- Side-stack presence by /stack alone; follow /clear.

## 0.2.0 (2026-11-09)

- Side-stack protocol v2: present only with its live /stack command; runs /stack on a new plan.
- `report_progress` refuses empty or unknown step names and calls before a plan.
- `/clear` empties the checklist; subagent calls to the plan tools are no-ops.

## 0.1.0 (2026-11-09)

- Plan checklist side pane, works alone or inside side-stack.
