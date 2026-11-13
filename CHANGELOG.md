# Changelog

Versions are the `version` in `.claude-plugin/plugin.json`. Newest first.

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
