# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Open the repository's
[Security tab](https://github.com/lucas-saldanha-werneck/plan-checklist/security) and choose
"Report a vulnerability" (GitHub private vulnerability reporting).

## Supported versions

Only the latest release is supported. Fixes land there.

## What this plugin accesses

- It runs inside Claude Code's mod host. It adds two tools, `plan_steps` and `report_progress`, that Claude calls to report its plan, and a side pane that shows the checklist.
- Files: it reads and creates `~/.config/plan-checklist/config.json`; the plan itself is kept in session state.
- Network and processes: the plugin's own code makes no network requests and starts no processes.

