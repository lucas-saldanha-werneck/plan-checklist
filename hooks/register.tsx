import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  PlanChecklist as Checklist,
  PlanPhase as Phase,
  PlanTask as Task,
  Register,
  ResolveInput,
} from 'claude-code'

import { CONFIG_EXAMPLE } from './config-example'
import {
  ENDED_EARLY,
  HAS_QUESTION,
  KEEPS_FAILING,
  NEEDS_OK,
  REFUSED,
  SAID_NO,
  apiErrorSentence,
  applyReport,
  checkReport,
  checkSteps,
  clampPercent,
  cleanName,
  errorKind,
  formatDuration,
  isUserRejection,
  newTask,
  planTitle,
  settle,
} from './plan'

// The pane this mod opens when it runs alone, and the shared pane of the
// side-stack host, where it draws a section instead when the host runs.
export const PANE = 'plan-checklist'
export const STACK_PANE = 'side-stack'

const checklistAtom = atom({ plugin: 'plan-checklist', key: 'checklist' } as const, null)
// true while the checklist is drawn in the side-stack pane; side-stack reads it.
const stackedAtom = atom({ plugin: 'plan-checklist', key: 'stacked' } as const, false)

const METER = 10
const LABEL_COLUMNS = 7
const MAX_ROWS = 10
const FAILS_BEFORE_STUCK = 3
const COLLAPSE_AFTER_MS = 5000
// Plugin load order is unknown: look for the host soon after start, and once more a second later.
const HOST_CHECKS_MS = [100, 1100]
const PANE_COLUMNS = 46
const STACKED_LINE = 'Shown in the Stack pane (/stack)'

// Tools that run before a plan exists, even with require_plan_first on: tool
// loading, to-do lists, questions, and the assumptions-pane mod's note tool.
const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  'mcp__assumptions-pane__log_assumption',
])

const PLACEHOLDER_STEPS = ['Understand your request', 'Plan the steps']

function guide(requirePlanFirst: boolean): string {
  const lines = [
    '# Plan checklist',
    '',
    'The person sees your plan as a checklist in a side pane. Keep it true.',
    '',
    '- When a request needs tools or more than one step, call `plan_steps` before any other tool, with every step of the job: 2 to 8 short names, in order. If it is deferred, load it with ToolSearch.',
    '- Write each step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".',
    '- Never put file paths, file names, commands, code or tool names in a step name.',
    "- Call `report_progress` as real progress happens, with the step's name and a percent. Call it with 100 the moment a step finishes.",
    '- If the plan changes, call `plan_steps` again with the new full list.',
    '- If this session has TodoWrite or TaskCreate, you may use the to-do list as the plan instead of `plan_steps`.',
  ]
  if (requirePlanFirst) {
    lines.push('- Other tools are refused until `plan_steps` (or a to-do list) has set the plan for the request.')
  }
  return lines.join('\n')
}

// Module variables start over on a hot reload; everything drawn lives in $.state.
let collapseTimer: { cancel: () => void } | null = null
let failStreak = 0
let lastSubmitWasCommand = false
let idCounter = 0
let lastErrorKind: string | null = null
let optionRequirePlanFirst = false
let fileRequirePlanFirst: boolean | null = null
// The gate as read at session start. It stays fixed for the session, so the
// system prompt and the gate always agree; a changed file applies next session.
let sessionRequirePlanFirst = false
// The side-stack pane: true once drawn, false once closed, null when not known.
let stackShown: boolean | null = null
// Running /stack failed: the own pane shows the full checklist instead.
let stackUnreachable = false
// The session id this module last set up under. A /clear goes on under a new
// id with no session.start, and session $.state (including `stacked`) is gone.
let loadedSessionId: string | null = null

const makeId = (): string => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`

function toolName($: EngineInterface, name: string): string {
  return `mcp__${$.plugin.name}__${name}`
}

function requirePlanFirst(): boolean {
  return sessionRequirePlanFirst
}

// ---- Settings file -------------------------------------------------------

async function home($: EngineInterface): Promise<string | undefined> {
  // Windows does not set HOME unless a shell like Git Bash does; it sets USERPROFILE.
  let h = await $.env.get('HOME')
  if (h === undefined || h === '') h = await $.env.get('USERPROFILE')
  return h !== undefined && h !== '' ? h : undefined
}

// POSIX /x, Windows C:\x or C:/x. A relative path would land in the session's folder.
const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

/** $XDG_CONFIG_HOME/plan-checklist/config.json, else ~/.config/plan-checklist/config.json. */
async function settingsFile($: EngineInterface): Promise<string | undefined> {
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const h = await home($)
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : h !== undefined ? `${h}/.config` : undefined
  const file = base === undefined ? undefined : `${base}/plan-checklist/config.json`
  return file !== undefined && isAbsolute(file) ? file : undefined
}

/** First run: writes the starter file with every key null. A file that is there is never rewritten. */
async function seedSettings($: EngineInterface): Promise<void> {
  try {
    const file = await settingsFile($)
    if (file === undefined || (await $.fs.exists(file))) return
    await $.fs.write(file, CONFIG_EXAMPLE)
  } catch {
    // Never get in the way of starting a session.
  }
}

/** Reads require_plan_first from the settings file: true, false, or null for "use the option". */
async function loadSettings($: EngineInterface): Promise<void> {
  try {
    const file = await settingsFile($)
    if (file === undefined) return
    const parsed: unknown = JSON.parse(await $.fs.read(file))
    const value =
      parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>).require_plan_first : null
    fileRequirePlanFirst = typeof value === 'boolean' ? value : null
  } catch {
    fileRequirePlanFirst = null
  }
}

// ---- The side-stack host and the pane ------------------------------------

/**
 * side-stack counts as there when its /stack command is listed, and only then.
 * Its `present` flag is session state, gone after a /clear, so it is not read.
 */
async function hostPresent($: EngineInterface): Promise<boolean> {
  try {
    const commands = await $.command.list()
    return commands.some(c => c.name === 'stack' && c.plugin?.split('@')[0] === 'side-stack')
  } catch {
    return false
  }
}

async function hasSurface($: EngineInterface): Promise<boolean> {
  // Headless runs (claude -p, robots) have no surface to draw on.
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return true
  }
}

async function ownPane($: EngineInterface): Promise<{ title: string } | undefined> {
  try {
    return (await $.ui.panes()).find(pane => pane.id === PANE)
  } catch {
    return undefined
  }
}

/** Opens (or retitles) the own pane, always with its width so the dock keeps it. */
async function openOwn($: EngineInterface, focus = false): Promise<void> {
  if (!(await hasSurface($))) return
  const title = planTitle(await read($, checklistAtom))
  try {
    await $.ui.open({ id: PANE, title, columns: PANE_COLUMNS, ...(focus ? { focus: true as const } : {}) })
  } catch {
    // The surface said no; the checklist still updates.
  }
}

/**
 * Looks for side-stack again and follows it: publishes `stacked`, closes the own
 * pane when the host is there, and brings the own pane back when the host left.
 * Returns whether the checklist is drawn in the side-stack pane.
 */
async function checkHost($: EngineInterface): Promise<boolean> {
  const now = await hostPresent($)
  const was = (await read($, stackedAtom)) === true
  if (now !== was) await update($, stackedAtom, () => now)
  if (now && !stackUnreachable) {
    if ((await ownPane($)) !== undefined) {
      try {
        await $.ui.close({ id: PANE })
      } catch {
        // Left open; it draws one line pointing at the Stack pane.
      }
    }
  } else if (!now && was && (await read($, checklistAtom)) !== null) {
    stackShown = null
    await openOwn($)
  }
  return now
}

/**
 * Asks side-stack to show its pane by running its /stack command. The run waits
 * until the session is idle and is refused inside a hook the turn waits on, so it
 * runs from a timer. If it fails, the own pane shows the full checklist instead.
 */
function bringStackForward($: EngineInterface): void {
  $.clock.after(0, () => {
    void (async () => {
      try {
        await $.command.run({ command: 'stack' })
        stackUnreachable = false
        stackShown = true
      } catch {
        stackUnreachable = true
        await openOwn($)
      }
    })()
  })
}

/** Makes the checklist visible: the Stack pane when side-stack runs, else the own pane. */
async function showChecklist($: EngineInterface, asked = false): Promise<'stack' | 'own'> {
  if (await checkHost($)) {
    if (asked || stackShown !== true) bringStackForward($)
    return 'stack'
  }
  await openOwn($, asked)
  return 'own'
}

/** Keeps the tab title in step with the checklist ("Plan 2/4"), while the own pane is open. */
async function syncTitle($: EngineInterface): Promise<void> {
  if ((await checkHost($)) && !stackUnreachable) return
  const pane = await ownPane($)
  if (pane === undefined) return
  if (pane.title === planTitle(await read($, checklistAtom))) return
  await openOwn($)
}

/**
 * After a /clear the session id changes and no session.start fires: start over
 * on the pane bookkeeping, look for side-stack again and re-publish `stacked`.
 * The checklist itself is not stored; session.end already emptied it.
 */
async function followSession($: EngineInterface): Promise<void> {
  let id: string
  try {
    id = await $.session.id()
  } catch {
    return
  }
  if (id === loadedSessionId) return
  const isFirst = loadedSessionId === null
  loadedSessionId = id
  if (isFirst) return
  stackShown = null
  stackUnreachable = false
  const now = await hostPresent($)
  await update($, stackedAtom, () => now)
  await checkHost($)
}

// ---- Checklist changes ---------------------------------------------------

async function change($: EngineInterface, fn: (list: Checklist) => Checklist): Promise<void> {
  await update($, checklistAtom, list => (list ? fn(list) : list))
  await syncTitle($)
}

async function setPhase(
  $: EngineInterface,
  phase: Phase,
  reasons: { needsYouReason?: string; stuckReason?: string } = {},
): Promise<void> {
  const now = await $.clock.now()
  await change($, list => ({
    ...list,
    phase,
    needsYouReason: reasons.needsYouReason ?? null,
    stuckReason: reasons.stuckReason ?? null,
    finishedAt: phase === 'done' || phase === 'stopped' ? now : null,
    isCollapsed: false,
  }))
}

async function finishJob($: EngineInterface): Promise<void> {
  const list = await read($, checklistAtom)
  if (!list) return
  const jobId = list.jobId
  await change($, one => ({
    ...one,
    tasks: one.tasks.map((task): Task => ({ ...task, status: 'done', percent: 100 })),
  }))
  await setPhase($, 'done')
  collapseTimer?.cancel()
  collapseTimer = $.clock.after(COLLAPSE_AFTER_MS, () => {
    void update($, checklistAtom, one =>
      one && one.jobId === jobId && one.phase === 'done' ? { ...one, isCollapsed: true } : one,
    )
  })
}

async function startJob($: EngineInterface, text: string): Promise<void> {
  collapseTimer?.cancel()
  collapseTimer = null
  failStreak = 0
  lastErrorKind = null
  const now = await $.clock.now()
  const list: Checklist = {
    jobId: now * 1000 + (idCounter++ % 1000),
    title: cleanName(text.split('\n')[0] ?? ''),
    phase: 'working',
    tasks: settle(PLACEHOLDER_STEPS.map(name => newTask(makeId(), name, 'upcoming'))),
    isPlanned: false,
    needsYouReason: null,
    stuckReason: null,
    startedAt: now,
    finishedAt: null,
    isCollapsed: false,
  }
  await update($, checklistAtom, () => list)
  await showChecklist($)
  await syncTitle($)
}

async function ensureJob($: EngineInterface): Promise<void> {
  if ((await read($, checklistAtom)) === null) await startJob($, 'Working on it')
}

async function replaceTasks($: EngineInterface, tasks: Task[]): Promise<void> {
  await change($, list => ({
    ...list,
    tasks: settle(tasks),
    isPlanned: true,
    phase: list.phase === 'needsYou' || list.phase === 'stuck' ? 'working' : list.phase,
    needsYouReason: null,
    stuckReason: null,
  }))
}

// ---- Drawing -------------------------------------------------------------

/** The checklist: a heading line, then one row per step (at most MAX_ROWS). */
async function drawChecklist<E extends ResolveInput>($: EngineInterface, e: E, columns: number) {
  const { Box, Text } = $.ui.resolve(e)
  const list = await read($, checklistAtom)
  const heading = planTitle(list)

  let status = <Text dimColor>No plan yet.</Text>
  if (list !== null) {
    const end = list.finishedAt ?? (await $.clock.now())
    const took = formatDuration(end - list.startedAt)
    if (list.phase === 'working') {
      status = (
        <Text wrap="truncate-end">
          <Text>{list.title}</Text>
          <Text dimColor> · {took}</Text>
        </Text>
      )
    } else if (list.phase === 'needsYou' && (list.needsYouReason ?? ENDED_EARLY) === ENDED_EARLY) {
      status = (
        <Text wrap="truncate-end">
          <Text inverse bold> Paused </Text>
          <Text dimColor> {ENDED_EARLY}</Text>
        </Text>
      )
    } else if (list.phase === 'needsYou') {
      status = (
        <Text wrap="truncate-end">
          <Text inverse bold color="yellow"> Needs you </Text>
          <Text> {list.needsYouReason ?? ENDED_EARLY}</Text>
        </Text>
      )
    } else if (list.phase === 'stuck') {
      status = (
        <Text wrap="truncate-end" color="yellow">
          ⚠ Stuck: {list.stuckReason ?? KEEPS_FAILING}
        </Text>
      )
    } else if (list.phase === 'stopped') {
      status = (
        <Text wrap="truncate-end">
          ■ Stopped · {list.title} · <Text dimColor>you pressed Esc</Text>
        </Text>
      )
    } else {
      status = (
        <Text wrap="truncate-end">
          <Text color="green">✓ All done</Text> · {list.title} · <Text dimColor>took {took}</Text>
        </Text>
      )
    }
  }

  const head = [
    <Text key="plan-heading" bold wrap="truncate-end">
      {heading}
    </Text>,
    <Box key="plan-status">{status}</Box>,
  ]
  if (list === null || (list.phase === 'done' && list.isCollapsed)) {
    return (
      <Box flexDirection="column" width={columns}>
        {head}
      </Box>
    )
  }

  const nameColumns = Math.max(6, columns - 2 - 1 - METER - 2 - LABEL_COLUMNS)
  const fit = (name: string): string =>
    name.length > nameColumns ? `${name.slice(0, nameColumns - 1)}…` : name.padEnd(nameColumns, ' ')
  const firstUpcoming = list.tasks.findIndex(task => task.status === 'upcoming')
  const isPaused = list.phase !== 'working'

  const rows = list.tasks.slice(0, MAX_ROWS).map((task, i) => {
    if (task.status === 'done') {
      return (
        <Text key={task.id} wrap="truncate-end">
          <Text color="green">✓ </Text>
          <Text dimColor>{fit(task.name)} </Text>
          <Text color="green">{'█'.repeat(METER)}</Text>
          <Text dimColor>  Done</Text>
        </Text>
      )
    }
    if (task.status === 'active') {
      let meter: string
      let label: string
      if (task.hasReported) {
        const filled = Math.max(0, Math.min(METER, Math.round(task.percent / 10)))
        meter = '█'.repeat(filled) + '░'.repeat(METER - filled)
        label = `${task.percent}%`
      } else {
        // A still bar: a moving one redraws the pane and swallows clicks in it.
        meter = '▓▓▓' + '░'.repeat(METER - 3)
        label = 'Working'
      }
      return (
        <Text key={task.id} wrap="truncate-end">
          <Text color="cyan">{isPaused ? '‖ ' : '▶ '}</Text>
          <Text bold>{fit(task.name)} </Text>
          <Text color="cyan">{meter}</Text>
          <Text>  {label}</Text>
        </Text>
      )
    }
    return (
      <Text key={task.id} wrap="truncate-end" dimColor>
        ○ {fit(task.name)} {'░'.repeat(METER)}  {i === firstUpcoming ? 'Next' : 'Up next'}
      </Text>
    )
  })
  if (list.tasks.length > MAX_ROWS) {
    rows.push(
      <Text key="plan-more" dimColor>
        … {list.tasks.length - MAX_ROWS} more
      </Text>,
    )
  }

  return (
    <Box flexDirection="column" width={columns}>
      {head}
      {rows}
    </Box>
  )
}

// ---- Hooks ---------------------------------------------------------------

export const register: Register = (on, options) => {
  optionRequirePlanFirst = options?.require_plan_first === true

  on('session.start', async ($, e, next) => {
    await seedSettings($)
    await loadSettings($)
    sessionRequirePlanFirst = fileRequirePlanFirst ?? optionRequirePlanFirst
    stackShown = null
    stackUnreachable = false
    loadedSessionId = await $.session.id().catch(() => null)
    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the job up front, in order, before any other tool. 2 to 8 short plain-English step names that start with a verb, under 40 characters, with no file names, paths, commands, code or tool names. The first step starts right away. Call it again with the full list if the plan changes.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 8,
            description: 'The step names, in order, like "Build the pricing section".',
          },
        },
        required: ['steps'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report real progress on the current step: its plain-English name and a percent from 0 to 100. Send 100 the moment a step finishes; the next step then starts. The name must be one of the planned steps; an unknown name is refused with the list of planned names.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The step name, as planned.' },
          percent: { type: 'number', minimum: 0, maximum: 100 },
        },
        required: ['task', 'percent'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'checklist', description: 'Show the plan checklist' })
    for (const ms of HOST_CHECKS_MS) {
      $.clock.after(ms, () => {
        void checkHost($).catch(() => undefined)
      })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    return {
      ...result,
      sections: [...result.sections, { id: 'plan-checklist:guide', text: guide(requirePlanFirst()), scope: 'session' as const }],
    }
  })

  on('command.run', { command: 'checklist' }, async $ => {
    await followSession($)
    const where = await showChecklist($, true)
    return { text: where === 'stack' ? 'The checklist is in the Stack pane; opening it.' : 'Checklist opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await followSession($)
    lastSubmitWasCommand = e.command !== undefined
    return next(e)
  }).catch(($, e, next) => next(e))

  // A real prompt while nothing runs starts a job; a reply clears "Needs you".
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await followSession($)
    const wasCommand = lastSubmitWasCommand
    lastSubmitWasCommand = false
    const text = e.text.trim()
    if (text === '' || wasCommand || text.startsWith('/')) return next(e)
    const list = await read($, checklistAtom)
    if (list !== null && (list.phase === 'working' || list.phase === 'needsYou')) {
      if (list.phase === 'needsYou') await setPhase($, 'working')
      return next(e)
    }
    await startJob($, text)
    return next(e)
  })

  // The two tools, the optional plan gate, to-do lists, questions and failures.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    // A subagent's plan is not shown: answer its plan tools so the call does not
    // fall through to a tool nobody else serves, and change nothing.
    if (e.agentId !== undefined) {
      if (tool === toolName($, 'plan_steps') || tool === toolName($, 'report_progress')) {
        return { result: "Noted. Only the main conversation's plan is shown on the checklist; no need to plan or report from a subagent." }
      }
      return next(e)
    }

    if (tool === toolName($, 'plan_steps') || tool === toolName($, 'report_progress')) await followSession($)

    if (tool === toolName($, 'plan_steps')) {
      const checked = checkSteps(input.steps)
      if ('error' in checked) return { deny: checked.error }
      await ensureJob($)
      await replaceTasks($, checked.names.map(name => newTask(makeId(), name, 'upcoming')))
      failStreak = 0
      return { result: `Planned ${checked.names.length} steps. The first one has started.` }
    }

    if (tool === toolName($, 'report_progress')) {
      const current = await read($, checklistAtom)
      const checked = checkReport(current?.tasks ?? [], current?.isPlanned === true, input.task)
      if ('error' in checked) return { deny: checked.error }
      const name = checked.name
      const percent = clampPercent(input.percent)
      await change($, list => ({
        ...list,
        tasks: settle(applyReport(list.tasks, name, percent, makeId)),
        phase: list.phase === 'stuck' || list.phase === 'needsYou' ? 'working' : list.phase,
        needsYouReason: null,
        stuckReason: null,
      }))
      return { result: `Progress noted: ${percent}%.` }
    }

    const list = await read($, checklistAtom)
    const isActive = list !== null && (list.phase === 'working' || list.phase === 'needsYou' || list.phase === 'stuck')

    if (requirePlanFirst() && isActive && !list.isPlanned && !ALWAYS_ALLOWED.has(tool)) {
      return {
        deny: `Plan checklist: call ${toolName($, 'plan_steps')} first with every step of the job in plain English (load it with ToolSearch if it is deferred), then try again.`,
      }
    }

    if (isActive && list.phase === 'needsYou') await setPhase($, 'working')

    if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
      const todos = input.todos as Array<{ content?: string; status?: string }>
      await ensureJob($)
      await replaceTasks(
        $,
        todos.map((todo, i) =>
          newTask(
            `todo${i}`,
            cleanName(String(todo.content ?? '')),
            todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : 'upcoming',
          ),
        ),
      )
    }

    if (tool === 'AskUserQuestion' && isActive) await setPhase($, 'needsYou', { needsYouReason: HAS_QUESTION })

    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    if (tool === 'TaskCreate' && ran.isError !== true) {
      const match = /#?(\d+)/.exec(ran.text ?? '')
      const id = match ? `task${match[1]}` : makeId()
      const name = cleanName(String(input.subject ?? ''))
      await ensureJob($)
      await change($, one => ({
        ...one,
        tasks: settle([...(one.isPlanned ? one.tasks : []), newTask(id, name, 'upcoming')]),
        isPlanned: true,
      }))
    }

    if (tool === 'TaskUpdate' && ran.isError !== true) {
      const id = `task${String(input.taskId ?? '')}`
      const status = input.status
      await change($, one => {
        const tasks =
          status === 'deleted'
            ? one.tasks.filter(task => task.id !== id)
            : one.tasks.map((task): Task => {
                if (task.id !== id) {
                  return status === 'in_progress' && task.status === 'active' ? { ...task, status: 'upcoming' } : task
                }
                const name = typeof input.subject === 'string' ? cleanName(input.subject) : task.name
                if (status === 'completed') return { ...task, name, status: 'done', percent: 100 }
                if (status === 'in_progress') return { ...task, name, status: 'active' }
                if (status === 'pending') return { ...task, name, status: 'upcoming' }
                return { ...task, name }
              })
        return { ...one, tasks: settle(tasks) }
      })
    }

    const after = await read($, checklistAtom)
    if (after === null || after.phase === 'done' || after.phase === 'stopped') return ran

    if (ran.isError === true) {
      if (isUserRejection(ran.text ?? '')) {
        failStreak = 0
        await setPhase($, 'stuck', { stuckReason: SAID_NO })
      } else {
        failStreak += 1
        if (failStreak >= FAILS_BEFORE_STUCK) await setPhase($, 'stuck', { stuckReason: KEEPS_FAILING })
        else if (after.phase === 'needsYou') await setPhase($, 'working')
      }
    } else {
      failStreak = 0
      if (after.phase === 'stuck' || after.phase === 'needsYou') await setPhase($, 'working')
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Permission prompts and other questions: "Needs you".
  on('classic.Notification', async ($, e, next) => {
    const list = await read($, checklistAtom)
    const type = String(e.notification_type ?? '')
    if (list !== null && (list.phase === 'working' || list.phase === 'stuck')) {
      if (type === 'permission_prompt' || /permission/i.test(e.message ?? '')) {
        await setPhase($, 'needsYou', { needsYouReason: NEEDS_OK })
      } else if (type === 'elicitation_dialog') {
        await setPhase($, 'needsYou', { needsYouReason: HAS_QUESTION })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.StopFailure', async ($, e, next) => {
    lastErrorKind = errorKind(String(e.error ?? ''), String(e.error_details ?? ''))
    const list = await read($, checklistAtom)
    if (list !== null && list.phase !== 'done' && list.phase !== 'stopped') {
      await setPhase($, 'stuck', { stuckReason: apiErrorSentence(lastErrorKind) })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A /clear ends the conversation; no session.start follows it. The old plan
  // goes with it, so the checklist empties; tools, command and settings stay.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      collapseTimer?.cancel()
      collapseTimer = null
      failStreak = 0
      lastErrorKind = null
      await update($, checklistAtom, () => null)
      await syncTitle($).catch(() => undefined)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const list = await read($, checklistAtom)
    if (list === null || list.phase === 'done' || list.phase === 'stopped') return result

    if (e.reason === 'error') {
      await setPhase($, 'stuck', { stuckReason: apiErrorSentence(lastErrorKind) })
    } else if (e.reason === 'refusal') {
      await setPhase($, 'stuck', { stuckReason: REFUSED })
    } else if (e.reason === 'aborted' || e.isAborted) {
      await setPhase($, 'stopped')
    } else if (list.phase === 'stuck' && list.stuckReason === SAID_NO) {
      // "You said no" stays up until the person replies.
    } else if (list.isPlanned && list.tasks.some(task => task.status !== 'done')) {
      await setPhase($, 'needsYou', { needsYouReason: ENDED_EARLY })
    } else {
      await finishJob($)
    }
    lastErrorKind = null
    return result
  })

  // Alone: the own pane.
  // While stacked it only points at the Stack pane, so the list never shows twice.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A render may not write state: a session change is followed from a timer.
    $.clock.after(0, () => void followSession($).catch(() => undefined))
    if ((await read($, stackedAtom)) === true && !stackUnreachable) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{STACKED_LINE}</Text>
    }
    return drawChecklist($, e, Math.max(20, e.props.bodyColumns))
  })

  // The side-stack pane closing: the next plan brings it forward again. Only
  // watched; the close always goes on.
  on('ui.close', { id: STACK_PANE }, async ($, e, next) => {
    const result = await next(e)
    stackShown = false
    return result
  }).catch(($, e, next) => next(e))

  // With the side-stack host: a section in its shared pane, then every other section beneath.
  on('ui.render', { component: 'Pane', requestId: STACK_PANE }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)
    const below = await next(e)
    stackShown = true
    $.clock.after(0, () => void followSession($).catch(() => undefined))
    let section
    try {
      section = await drawChecklist($, e, Math.max(20, e.props.bodyColumns))
    } catch {
      // A broken section must never hide the others.
      return below
    }
    return (
      <Box flexDirection="column">
        {section}
        {below}
      </Box>
    )
  })
}
