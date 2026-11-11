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

The first line of the checklist, and the pane's tab title, follow the plan: `Plan 2/4` while Claude
works, `Plan · needs you` when Claude waits for your OK or has a question, `Plan · paused` when
Claude ended its turn before the last step, `Plan · stuck`, `Plan · stopped` after Esc, and
`Plan · done`. Claude Code draws a pane's tab title only while more than one pane is open, so the
same words are always on the checklist's first line too.

## What Claude sees

The mod registers two tools and adds a short section to the system prompt asking Claude to plan
first and report progress:

- `plan_steps({ "steps": [...] })`: every step of the job up front, 2 to 8 short plain-English names
  that start with a verb, under 40 characters, with no file names, paths, commands, code or tool
  names. Fewer than 2 or more than 8 is refused with a note to try again. Code and paths left in a
  name are removed before it is shown, and two names that read the same after that are refused.
- `report_progress({ "task": "Build the pricing section", "percent": 60 })`: progress on a step.
  At 100 the step is ticked off, any earlier step not yet ticked is ticked too, and the next one
  starts. An empty name, or one that is not in the plan, is refused with the list of planned names,
  and nothing on the checklist changes. Before any plan, it is refused with a note to call
  `plan_steps` first.
- A subagent's calls to either tool are answered and change nothing: only the main conversation's
  plan is shown.

If the session uses TodoWrite or the task tools, the to-do list is shown as the plan too.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin marketplace add lucas-saldanha-werneck/claude-plugins
/plugin install plan-checklist@lucas-tools
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
- `/clear` empties the checklist; the next prompt starts a new one, in the same place (the Stack
  pane when side-stack runs). Nothing is saved between sessions.

## Settings

The first session creates `~/.config/plan-checklist/config.json` (or
`$XDG_CONFIG_HOME/plan-checklist/config.json`) with every key set to `null`, which means the
default. Plugin updates never rewrite that file. Changes apply from the next session (a new
session, not `/clear`): the setting is read once at session start, so the rule Claude is told about
and the rule that is enforced always match.

| Key | Default | What it does |
| --- | --- | --- |
| `require_plan_first` | off | `true`: every other tool call is refused until Claude has called `plan_steps` (or written a to-do list) for the request. ToolSearch, the to-do tools, AskUserQuestion, the assumptions-pane mod's `log_assumption` and subagents are never refused. `false`: never refused. `null`: use the option in `/config`. |

The same switch is in `/config` as "Require a plan first" (off by default). A `true` or `false` in
the file wins over it.

## Works alone or inside side-stack

Claude Code shows separate panes as tabs, one at a time. The side-stack mod opens one shared pane so
several mods can draw in it one under the other. plan-checklist counts side-stack as running when
side-stack's `/stack` command is listed, and only then (side-stack's own flag is session state and
is gone after `/clear`, so it is not used). It looks again at session start, a second later, on
every change to the checklist, and after a `/clear` (which goes on under a new session id without a
new session start):

- side-stack running: no pane of its own (it closes one it had opened, or shows one line there,
  "Shown in the Stack pane (/stack)", so the list never shows twice). The checklist is a section of
  the side-stack pane, headed `Plan 2/4`, with the other mods' sections (assumptions-pane,
  idea-shelf, clean-view) beneath or above it. side-stack decides the order: install order by
  default, changeable with `/stack order`. plan-checklist draws its section keyed
  `side-stack:plan-checklist` and puts it in the empty slot side-stack leaves for it
  (`side-stack:slot:plan-checklist`); with an older side-stack that leaves no slot, the section goes
  on top of the ones loaded after it.
- A new plan or `/checklist` runs `/stack` to bring the Stack pane forward when plan-checklist does
  not know it to be open. Claude Code runs a plugin's command once the session is idle, so during a
  turn the Stack pane may come up only when Claude finishes. If `/stack` is refused, the own pane
  opens with the full checklist.
- plan-checklist publishes `stacked` (true while it draws in the Stack pane) for side-stack to read.
- side-stack not running, or gone: its own pane again.

## Terminal and desktop app

The same code draws in both, and every test runs on both surfaces. What differs is Claude Code's
own pane handling:

- In a terminal, a pane opens by itself only when the window is wide enough (144 columns, 110 once
  you have opened it before); `/checklist` opens it at any width. The pane asks for 46 columns of
  dock width; Claude Code uses that only for the terminal's dock (at most 45% of the window) and
  ignores it elsewhere.
- In the desktop app the pane sits in the app's own pane area. The tests draw it there; nobody has
  tried it by hand in the app yet.

## Uninstall

```
/plugin uninstall plan-checklist@lucas-tools
```

## Limits

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- The tests run every case on the `terminal` and `desktop` surfaces, with and without a stand-in for
  side-stack. Nobody has tried it by hand in the desktop app or on mobile yet.
- Whether Claude Code tells plan-checklist when the side-stack pane is closed is not proven; if it
  does not, a closed Stack pane comes back with `/checklist` or `/stack`.
- Headless runs (`claude -p`) open no pane. `require_plan_first` applies there too when it is on.
- The pane shows at most 10 steps; more are counted on one line.
- Tests: `claude plugin validate .` and `claude plugin test .` (CI runs both on Linux, macOS and
  Windows).

## Credits

This comes from Clean View, a private mod Lucas Saldanha Werneck built for himself and uses every
day; this repo is the plan checklist part of it, cleaned up to stand alone. Clean View's idea comes
from the "Plain Answers" mod in the AI LABS video
[Claude Mods Are Insane... You Need To Try These Right Now](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=701)
(11:41, 9 Oct 2026). This code was written separately with Claude Code.

## License

MIT. See `LICENSE`.

Built with Claude Code
