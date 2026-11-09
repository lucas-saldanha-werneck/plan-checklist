// Pure checklist logic: no engine calls, so the tests can use it directly.
import type { Checklist, Task } from '../types'

export const MIN_STEPS = 2
export const MAX_STEPS = 8
const MAX_NAME = 40

const CODE_EXTENSION =
  /\.(tsx?|jsx?|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|json|jsonl|ya?ml|toml|md|mdx|css|scss|less|html?|sh|zsh|bash|sql|vue|svelte|lock|env|txt|xml|ini|cfg|conf|plist|ipynb|gradle|dart|lua|pl|r)\b/i

export const NEEDS_OK = 'Claude needs your OK to continue'
export const HAS_QUESTION = 'Claude has a question for you'
export const ENDED_EARLY = 'Claude ended its turn before the last step'
export const SAID_NO = 'you said no to a step, so Claude paused'
export const KEEPS_FAILING = 'a step keeps failing, Claude is trying another way'
export const REFUSED = "Claude couldn't help with that request"

/** Makes one step or job name plain: no code, no paths, no file names, 40 characters at most. */
export function cleanName(raw: string): string {
  const withoutCode = String(raw ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/`/g, ' ')
  const words = withoutCode
    .split(/\s+/)
    .filter(word => word !== '' && !/[\\/]/.test(word) && !CODE_EXTENSION.test(word))
  let text = words.join(' ').replace(/\s+/g, ' ').trim()
  text = text.replace(/^[\s,;:.\-–—]+/, '').replace(/[\s,;:\-–—]+$/, '')
  if (text === '') return 'Working on it'
  text = text.charAt(0).toUpperCase() + text.slice(1)
  if (text.length <= MAX_NAME) return text
  const room = text.slice(0, MAX_NAME - 1)
  const cut = room.lastIndexOf(' ')
  const head = (cut > 0 ? room.slice(0, cut) : room).replace(/[\s,;:.\-–—]+$/, '')
  return `${head}…`
}

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function clampPercent(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds % 60}s`
}

export function apiErrorSentence(kind: string | null): string {
  switch (kind) {
    case 'rate_limit':
    case 'billing_error':
      return 'you hit your usage limit, try again a little later'
    case 'overloaded':
    case 'server_error':
      return "Claude's servers are busy, try again in a minute"
    case 'max_output_tokens':
    case 'prompt_too_long':
      return 'type /compact and try again'
    case 'network':
      return 'the internet connection dropped'
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'cloud_credential_error':
      return 'type /login'
    default:
      return 'something went wrong, try again in a minute'
  }
}

/** Reads the error kind out of a StopFailure: its `error` field, then the words of its details. */
export function errorKind(error: string, details: string): string {
  const words = `${error} ${details}`.toLowerCase()
  if (/prompt is too long|prompt_too_long|context (window|length)/.test(words)) return 'prompt_too_long'
  if (error !== 'rate_limit' && /econn|enotfound|etimedout|network|fetch failed|socket|connection/.test(words)) return 'network'
  return error
}

export function isUserRejection(text: string): boolean {
  return /doesn't want to proceed|does not want to proceed|user rejected|user denied|rejected by (the )?user|denied by the user|user declined/i.test(
    text,
  )
}

export function newTask(id: string, name: string, status: Task['status']): Task {
  return { id, name, status, percent: status === 'done' ? 100 : 0, hasReported: false }
}

/** Keeps exactly one active step: the first one not done, when none is active. */
export function settle(tasks: Task[]): Task[] {
  if (tasks.some(task => task.status === 'active')) return tasks
  const first = tasks.findIndex(task => task.status !== 'done')
  if (first === -1) return tasks
  return tasks.map((task, i): Task => (i === first ? { ...task, status: 'active' } : task))
}

/** Applies a report: steps before it are done, it is active at `percent`, and at 100 the next one starts. */
export function applyReport(tasks: Task[], name: string, percent: number, makeId: () => string): Task[] {
  let list = tasks.slice()
  let index = list.findIndex(task => sameName(task.name, name))
  if (index === -1) {
    list.push(newTask(makeId(), name, 'upcoming'))
    index = list.length - 1
  }
  list = list.map((task, i): Task => {
    if (i < index) return task.status === 'done' ? task : { ...task, status: 'done', percent: 100 }
    if (i === index) {
      return percent >= 100
        ? { ...task, status: 'done', percent: 100, hasReported: true }
        : { ...task, status: 'active', percent, hasReported: true }
    }
    return task.status === 'active' ? { ...task, status: 'upcoming' } : task
  })
  if (percent >= 100) {
    const nextIndex = list.findIndex((task, i) => i > index && task.status !== 'done')
    if (nextIndex !== -1) {
      list = list.map((task, i): Task => (i === nextIndex ? { ...task, status: 'active', percent: 0, hasReported: false } : task))
    }
  }
  return list
}

/** The pane's tab title and the stacked section's heading: "Plan 2/4", "Plan · needs you", "Plan · done". */
export function planTitle(list: Checklist | null): string {
  if (list === null) return 'Plan'
  switch (list.phase) {
    case 'done':
      return 'Plan · done'
    case 'stopped':
      return 'Plan · stopped'
    case 'stuck':
      return 'Plan · stuck'
    case 'needsYou':
      return (list.needsYouReason ?? ENDED_EARLY) === ENDED_EARLY ? 'Plan · paused' : 'Plan · needs you'
    default: {
      if (!list.isPlanned || list.tasks.length === 0) return 'Plan'
      const done = list.tasks.filter(task => task.status === 'done').length
      return `Plan ${done}/${list.tasks.length}`
    }
  }
}

/** Checks and cleans the steps handed to plan_steps: 2 to 8 names, or an error to send back. */
export function checkSteps(raw: unknown): { names: string[] } | { error: string } {
  const list = Array.isArray(raw) ? raw : []
  const names = list.map(step => String(step ?? '').trim()).filter(step => step !== '').map(cleanName)
  if (names.length < MIN_STEPS || names.length > MAX_STEPS) {
    return {
      error: `plan_steps needs ${MIN_STEPS} to ${MAX_STEPS} step names; it got ${names.length}. Send every step of the job again, in order, as short plain-English names that start with a verb.`,
    }
  }
  return { names }
}
