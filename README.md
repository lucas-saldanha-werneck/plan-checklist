# plan-checklist

A Claude Code mod that shows Claude's plan as a short checklist in a side pane and ticks each step
off as Claude works. You see where the job stands ("Plan 2/4") without reading tool calls.

Works alone or inside side-stack: on its own it opens its own pane; when the
[side-stack](https://github.com/lucas-saldanha-werneck/side-stack) mod runs, the checklist becomes one
section of that shared pane instead.

This sketch shows roughly how the pane looks in a terminal. It is not a screenshot:

```
Plan 1/4
Build my landing page · 1m 12s
✓ Read your brand notes      ██████████  Done
▶ Build the pricing section  ██████░░░░  60%
○ Add the contact form       ░░░░░░░░░░  Next
○ Polish the footer          ░░░░░░░░░░  Up next
```

The pane's tab title follows the plan: `Plan 2/4` while Claude works, `Plan · needs you` when Claude
waits for your OK or has a question, `Plan · paused` when Claude ended its turn before the last
step, `Plan · stuck`, `Plan · stopped` after Esc, and `Plan · done`.

## What Claude sees

The mod registers two tools and adds a short section to the system prompt asking Claude to plan
first and report progress:

- `plan_steps({ "steps": [...] })`: every step of the job up front, 2 to 8 short plain-English names
  that start with a verb, under 40 characters, with no file names, paths, commands, code or tool
  names. Fewer than 2 or more than 8 is refused with a note to try again. Code and paths left in a
  name are removed before it is shown.
- `report_progress({ "task": "Build the pricing section", "percent": 60 })`: progress on a step.
  At 100 the step is ticked off and the next one starts. A name not in the plan becomes a new step.

If the session uses TodoWrite or the task tools, the to-do list is shown as the plan too.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install plan-checklist@lucas-plugins
```

If you have not added the `lucas-plugins` marketplace yet, add it first with
`/plugin marketplace add lucas-saldanha-werneck/claude-plugins`. You can also install from this repo
alone:

```
/plugin marketplace add lucas-saldanha-werneck/plan-checklist
/plugin install plan-checklist@plan-checklist
```

From a shell, the same commands work with `claude plugin` in place of `/plugin`. `/plugin` does not
run in the desktop app: install from a terminal with the user scope, and the mod also loads in the
desktop app's local Code sessions.

## Use

- The pane opens by itself when you send a prompt. In a terminal it only opens by itself when the
  window is at least 144 columns wide (110 if you have opened it before).
- `/checklist` opens it at any width. With side-stack running, the checklist is in the side-stack
  pane instead.
- When every step is done and the turn ends, the list shows "All done" and shrinks to one line after
  5 seconds. The next prompt starts a new plan.

## Settings

The first session creates `~/.config/plan-checklist/config.json` (or
`$XDG_CONFIG_HOME/plan-checklist/config.json`) with every key set to `null`, which means the
default. Plugin updates never rewrite that file. Changes apply from the next prompt.

| Key | Default | What it does |
| --- | --- | --- |
| `require_plan_first` | off | `true`: every other tool call is refused until Claude has called `plan_steps` (or written a to-do list) for the request. ToolSearch, the to-do tools, AskUserQuestion and subagents are never refused. `false`: never refused. `null`: use the option in `/config`. |

The same switch is in `/config` as "Require a plan first" (off by default). A `true` or `false` in
the file wins over it.

## Works alone or inside side-stack

Claude Code shows separate panes as tabs, one at a time. The side-stack mod opens one shared pane so
several mods can draw in it one under the other. plan-checklist looks for side-stack at session
start and again a second later:

- side-stack running: no pane of its own (it closes one it had opened); the checklist is a section
  of the side-stack pane, headed `Plan 2/4`, with the other mods' sections beneath or above it. The
  order follows the order Claude Code loads the plugins in, which a mod cannot choose.
- side-stack not running: its own pane, as above.

## Uninstall

```
/plugin uninstall plan-checklist@lucas-plugins
```

## Limits and what was not tested

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- The tests draw the pane on the `terminal` and `desktop` surfaces, with and without a stand-in for
  side-stack. Nobody has tried it by hand in the desktop app or on mobile yet.
- Headless runs (`claude -p`) open no pane. `require_plan_first` applies there too when it is on.
- The pane shows at most 10 steps; more are counted on one line.
- Tests: `claude plugin validate .` and `claude plugin test .` (CI runs both on Linux, macOS and
  Windows).

## Credits

This comes from a private mod Lucas Saldanha Werneck built for himself and uses every day; this repo
is the plan checklist part of it, cleaned up to stand alone.

## License

MIT. See `LICENSE`.

Built with Claude Code
