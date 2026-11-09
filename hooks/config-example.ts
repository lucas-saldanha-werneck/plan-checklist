// The starter settings file. On the first session with no settings file,
// plan-checklist writes this text to ~/.config/plan-checklist/config.json (or
// $XDG_CONFIG_HOME/plan-checklist/config.json). Every key is null, which means
// "use the default", so the file changes nothing until you edit it. A file that
// is already there is never rewritten.
export const CONFIG_EXAMPLE = `{
  "_doc": {
    "about": "Your plan-checklist settings. Plugin updates never touch this file. null means the default. Keys that start with _ are ignored. Changes apply from the next session (a new session, not /clear).",
    "require_plan_first": "true: every other tool call is refused until Claude has called plan_steps for the request (subagents, ToolSearch, to-do tools and AskUserQuestion are never refused). false: never refused. null (default): use the require_plan_first option in /config, which is off unless you turn it on."
  },
  "require_plan_first": null
}
`
