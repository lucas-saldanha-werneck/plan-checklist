# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Open the repository's
[Security tab](https://github.com/lucas-saldanha-werneck/plan-checklist/security) and choose
"Report a vulnerability" (GitHub private vulnerability reporting).

## Supported versions

Only the latest release is supported. Fixes land there.

## What this plugin accesses

- It runs inside Claude Code's mod host. It adds two tools, `plan_steps` and `report_progress`, that Claude calls to report its plan, a side pane that shows the checklist, and a short instruction to Claude's prompt in every session.
- It watches every tool call, notification and API error of the main conversation to update the checklist, and reads the steps of Claude's own to-do tools (TodoWrite, TaskCreate, TaskUpdate). It changes nothing unless you turn on `require_plan_first` (off by default): then it refuses other tool calls until Claude has called `plan_steps`.
- Files: it reads and creates `~/.config/plan-checklist/config.json` (or under `$XDG_CONFIG_HOME`); the plan itself is kept in session state only.
- Other plugins: if the side-stack plugin is installed, it may run its `/stack` command to show the checklist there.
- Network and processes: the plugin's own code makes no network requests and starts no processes.
