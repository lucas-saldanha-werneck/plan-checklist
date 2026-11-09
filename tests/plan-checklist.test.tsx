import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONFIG_EXAMPLE } from '../hooks/config-example'
import { checkSteps, cleanName, planTitle } from '../hooks/plan'

const PLAN = 'mcp__plan-checklist__plan_steps'
const REPORT = 'mcp__plan-checklist__report_progress'

// On Windows the engine resolves a drive-less absolute path onto the current
// drive with backslashes (D:\home\u\...). Compare paths in POSIX form.
const posix = (p: string): string => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const CONFIG = '/home/u/.config/plan-checklist/config.json'

const OWN_PANE = {
  component: 'Pane',
  requestId: 'plan-checklist',
  props: { title: 'Plan', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
} as const

const STACK_PANE = {
  component: 'Pane',
  requestId: 'side-stack',
  props: { title: 'Stack', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
} as const

type World = {
  clock: ReturnType<typeof mock.clock>
  /** Every ui.open, as "id:title". */
  opened: string[]
  closed: string[]
  writes: { path: string; text: string }[]
  denied: string[]
}

type Setup = {
  /** Files by POSIX path. A path not listed does not exist. */
  files?: Record<string, string>
}

// Stand-ins for the side-stack host. The kit loads an inline plugin from its
// source alone, so each one is spelled out with no outside variables.
/** The host, there from the start. */
const HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'side-stack', key: 'present' }, true)
      return next(e)
    })
  },
}

/** The host, loading half a second late. */
const LATE_HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      $.clock.after(500, () => void $.state.set({ plugin: 'side-stack', key: 'present' }, true))
      return next(e)
    })
  },
}

/** The world beneath the plugin: clock, files, panes, a host (or not), and a tool that always works. */
async function boot($: Engine, on: On, setup: Setup = {}): Promise<World> {
  const files = { ...(setup.files ?? {}) }
  const world: World = { clock: mock.clock(on, { now: 1_000_000 }), opened: [], closed: [], writes: [], denied: [] }
  mock.env(on, { HOME: '/home/u' })
  on('fs.exists', async (_$, e) => ({ value: posix((e as { path: string }).path) in files }) as never)
  on('fs.read', async (_$, e) => {
    const path = posix((e as { path: string }).path)
    if (!(path in files)) throw new Error(`ENOENT: ${path}`)
    return { value: files[path] } as never
  })
  on('fs.write', async (_$, e) => {
    const w = e as { path: string; text: string }
    world.writes.push({ path: posix(w.path), text: w.text })
    files[posix(w.path)] = w.text
    return { value: undefined } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__plan-checklist__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const panes = new Map<string, string>()
  on('ui.open', async (_$, e) => {
    world.opened.push(`${e.id}:${e.title ?? ''}`)
    panes.set(e.id, e.title ?? '')
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async (_$, e) => {
    world.closed.push(e.id)
    panes.delete(e.id)
    return { value: undefined } as never
  })
  on('ui.panes', async () => ({ value: [...panes].map(([id, title]) => ({ id, title, isPlaced: true })) as never }))
  // The host's own part of its pane, beneath this mod's section.
  on('ui.render', { component: 'Pane', requestId: 'side-stack' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>HOST-AND-OTHERS</Text>
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return world
}

type Called = { deny?: string; result?: unknown }

/** Calls a tool the way the model would. */
async function call($: Engine, input: object): Promise<Called> {
  return ($.tool.call as unknown as (input: object) => Promise<Called>)(input)
}

async function startJob($: Engine, text = 'Build my landing page'): Promise<void> {
  await $.turn.start({ text, turnId: 't1' })
}

async function paneTexts($: Engine, pane: typeof OWN_PANE | typeof STACK_PANE, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'plan-checklist', surface, ...pane })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts
}

describe('plan_steps', () => {
  test('takes 2 to 8 plain names and refuses fewer or more', async ($, on) => {
    await boot($, on)
    await startJob($)
    const one = await call($, { tool: PLAN, steps: ['Do it all'] })
    expect(one.deny).toContain('2 to 8')
    const nine = await call($, { tool: PLAN, steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })
    expect(nine.deny).toContain('2 to 8')
    const ok = await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page in `src/App.tsx`'] })
    expect(ok.result).toBe('Planned 2 steps. The first one has started.')
    const all = (await paneTexts($, OWN_PANE)).join('\n')
    expect(all).toContain('Read your notes')
    expect(all).toContain('Build the page in')
    expect(all).not.toContain('App.tsx')
  })

  test('names lose code and paths and stay under 40 characters', () => {
    expect(cleanName('fix the bug in src/app/main.ts for the header')).toBe('Fix the bug in for the header')
    expect(cleanName('`npm test`')).toBe('Working on it')
    expect(cleanName('Rewrite every single paragraph of the about page so it reads warmly').length <= 40).toBe(true)
    expect('error' in checkSteps(['', '  ', 'One'])).toBe(true)
  })
})

describe('report_progress', () => {
  test('a 60% report fills the bar, 100 ticks the step and starts the next', async ($, on) => {
    await boot($, on)
    await startJob($)
    await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page', 'Check it works'] })
    const sixty = await call($, { tool: REPORT, task: 'Read your notes', percent: 60 })
    expect(sixty.result).toBe('Progress noted: 60%.')
    for (const surface of ['terminal', 'desktop'] as const) {
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
      expect(all).toContain('██████░░░░')
      expect(all).toContain('60%')
      expect(all).toContain('Next')
      expect(all).toContain('Up next')
    }
    await call($, { tool: REPORT, task: 'Read your notes', percent: 100 })
    const all = (await paneTexts($, OWN_PANE)).join('\n')
    expect(all).toContain('Done')
    expect(all).toContain('▶')
    expect(all).toContain('Working')
  })

  test('the turn ending with every step done shows All done, then one line after 5 seconds', async ($, on) => {
    const world = await boot($, on)
    await startJob($)
    await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
    await call($, { tool: REPORT, task: 'Build the page', percent: 100 })
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect((await paneTexts($, OWN_PANE)).join('\n')).toContain('All done')
    await world.clock.advance(5000)
    const texts = await paneTexts($, OWN_PANE)
    expect(texts.join('\n')).not.toContain('Build the page')
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan · done')
  })
})

describe('tab title', () => {
  test('shows progress, then needs you, then done', async ($, on) => {
    const world = await boot($, on)
    await startJob($)
    expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
    await call($, { tool: PLAN, steps: ['One', 'Two', 'Three', 'Four'] })
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan 0/4')
    await call($, { tool: REPORT, task: 'Two', percent: 100 })
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan 2/4')
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan · needs you')
    expect((await paneTexts($, OWN_PANE)).join('\n')).toContain('Claude needs your OK to continue')
    await call($, { tool: REPORT, task: 'Four', percent: 100 })
    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan · done')
  })

  test('a turn that ends early with no question says paused', async ($, on) => {
    const world = await boot($, on)
    await startJob($)
    await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
    await $.turn.complete({ answer: 'Waiting.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan · paused')
    expect((await paneTexts($, OWN_PANE)).join('\n')).toContain('Paused')
    expect(planTitle(null)).toBe('Plan')
  })

  test('/checklist reopens the pane', async ($, on) => {
    const world = await boot($, on)
    const ran = await $.command.run({ command: 'checklist', args: '' } as never)
    expect(JSON.stringify(ran)).toContain('Checklist opened')
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan')
  })
})

describe('require_plan_first', () => {
  test('off by default: a tool runs before any plan', async ($, on) => {
    await boot($, on)
    await startJob($)
    const ran = await call($, { tool: 'Bash', command: 'ls' })
    expect(ran.deny).toBeUndefined()
  })

  test('on in the config file: refused before a plan, allowed after', async ($, on) => {
    await boot($, on, { files: { [CONFIG]: JSON.stringify({ require_plan_first: true }) } })
    await startJob($)
    const before = await call($, { tool: 'Bash', command: 'ls' })
    expect(before.deny).toContain('plan_steps')
    const search = await call($, { tool: 'ToolSearch', query: 'plan' })
    expect(search.deny).toBeUndefined()
    await call($, { tool: PLAN, steps: ['Look around', 'Answer'] })
    const after = await call($, { tool: 'Bash', command: 'ls' })
    expect(after.deny).toBeUndefined()
  })

  test('on in /config: refused before a plan', { options: { require_plan_first: true } }, async ($, on) => {
    await boot($, on)
    await startJob($)
    expect((await call($, { tool: 'Bash', command: 'ls' })).deny).toContain('plan_steps')
  })

  test('false in the config file wins over /config', { options: { require_plan_first: true } }, async ($, on) => {
    await boot($, on, { files: { [CONFIG]: JSON.stringify({ require_plan_first: false }) } })
    await startJob($)
    expect((await call($, { tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  })

  test('the system prompt asks for a plan, and names the rule only when it is on', async ($, on) => {
    on('prompt.compose', async () => ({ sections: [] }))
    await boot($, on, { files: { [CONFIG]: JSON.stringify({ require_plan_first: true }) } })
    const req = { model: 'claude-test', promptModel: 'claude-test', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never
    const text = (await $.prompt.compose(req)).sections.find(s => s.id === 'plan-checklist:guide')?.text ?? ''
    expect(text).toContain('plan_steps')
    expect(text).toContain('report_progress')
    expect(text).toContain('Other tools are refused')
  })
})

describe('config file', () => {
  test('the first session writes it with null keys', async ($, on) => {
    const world = await boot($, on)
    expect(world.writes).toEqual([{ path: CONFIG, text: CONFIG_EXAMPLE }])
    expect(JSON.parse(CONFIG_EXAMPLE).require_plan_first).toBe(null)
  })

  test('a file that is there is never rewritten', async ($, on) => {
    const world = await boot($, on, { files: { [CONFIG]: '{ "require_plan_first": true }' } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    expect(world.writes).toEqual([])
  })
})

describe('side-stack', () => {
  test('alone: own pane with the checklist', async ($, on) => {
    const world = await boot($, on)
    await startJob($)
    await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
    expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
    const all = (await paneTexts($, OWN_PANE)).join('\n')
    expect(all).toContain('Read your notes')
  })

  test('with the host: no own pane, a "Plan 1/2" section above the other sections', { plugins: [HOST] }, async ($, on) => {
    const world = await boot($, on)
    await startJob($)
    await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
    await call($, { tool: REPORT, task: 'Read your notes', percent: 100 })
    expect(world.opened.filter(one => one.startsWith('plan-checklist:'))).toEqual([])
    const ran = await $.command.run({ command: 'checklist', args: '' } as never)
    expect(JSON.stringify(ran)).toContain('side-stack')
    for (const surface of ['terminal', 'desktop'] as const) {
      const texts = await paneTexts($, STACK_PANE, surface)
      const heading = texts.findIndex(one => one === 'Plan 1/2')
      const host = texts.findIndex(one => one.includes('HOST-AND-OTHERS'))
      expect(heading).toBe(0)
      expect(host > heading).toBe(true)
      expect(texts.join('\n')).toContain('Build the page')
    }
  })

  test('a pane opened before the host showed up is closed by the check a second after start', { plugins: [LATE_HOST] }, async ($, on) => {
    const world = await boot($, on)
    await $.command.run({ command: 'checklist', args: '' } as never)
    expect(world.opened.at(-1)).toBe('plan-checklist:Plan')
    await world.clock.advance(1200)
    expect(world.closed).toEqual(['plan-checklist'])
  })
})
