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
  /** The columns asked for on each ui.open. */
  columns: (number | undefined)[]
  closed: string[]
  writes: { path: string; text: string }[]
  /** Every slash command a plugin ran with $.command.run. */
  ran: string[]
}

type Setup = {
  /** Files by POSIX path. A path not listed does not exist. */
  files?: Record<string, string>
  /** $.command.run({ command: 'stack' }) is refused. */
  stackRunFails?: boolean
  /** The surface the session starts on. */
  surface?: Surface
  /** side-stack beneath orders the sections and leaves an empty slot for plan-checklist between two others. */
  slot?: boolean
}

type Surface = 'terminal' | 'desktop'
// Every test runs on both: the mod must work in the terminal and the desktop app.
const SURFACES: readonly Surface[] = ['terminal', 'desktop']

// Stand-ins for the side-stack host. The kit loads an inline plugin from its
// source alone, so each one is spelled out with no outside variables. The real
// host sets its flag and registers /stack at session start.
/** The host, there from the start. */
const HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'side-stack', key: 'present' }, true)
      await $.command.register({ name: 'stack', description: 'Open the Stack side pane' })
      return next(e)
    })
  },
}

/** The host, turning up half a second late (enabled after the own pane opened). */
const LATE_HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      $.clock.after(500, () => {
        void $.state.set({ plugin: 'side-stack', key: 'present' }, true)
        void $.command.register({ name: 'stack', description: 'Open the Stack side pane' })
      })
      return next(e)
    })
  },
}

/** The host as seen after a /clear: /stack is listed, its session flag is gone. */
const COMMAND_ONLY_HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: 'stack', description: 'Open the Stack side pane' })
      return next(e)
    })
  },
}

/** A flag left standing with no /stack command: the host is not really there. */
const STALE_HOST: Plugin = {
  name: 'side-stack',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'side-stack', key: 'present' }, true)
      return next(e)
    })
  },
}

/** Reads plan-checklist's published `stacked` flag, as side-stack would: /stacked answers it. */
const READER: Plugin = {
  name: 'reader',
  register: on => {
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: 'stacked', description: 'test: read the stacked flag' })
      return next(e)
    })
    on('command.run', { command: 'stacked' }, async $ => {
      const { value } = await $.state.get({ plugin: 'plan-checklist', key: 'stacked' })
      return { text: String(value === true) }
    })
  },
}

async function stackedFlag($: Engine): Promise<string> {
  const ran = (await $.command.run({ command: 'stacked', args: '' } as never)) as { text?: string }
  return String(ran.text)
}

/** The world beneath the plugin: clock, files, panes, a host (or not), and a tool that always works. */
async function boot($: Engine, on: On, setup: Setup = {}): Promise<World> {
  // The test's own object, so a test can change a file mid-session.
  const files = setup.files ?? {}
  const world: World = { clock: mock.clock(on, { now: 1_000_000 }), opened: [], columns: [], closed: [], writes: [], ran: [] }
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
  // The engine knows which plugin registered a command; this stand-in names the
  // owner from the name, as a marketplace install shows it (name@marketplace).
  const commands: string[] = []
  on('command.register', (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('command.list', async () => ({
    value: commands.map(name => ({
      name,
      description: '',
      source: 'plugin',
      isFullscreen: false,
      plugin: `${name === 'stack' ? 'side-stack' : 'plan-checklist'}@lucas-plugins`,
    })),
  }) as never)
  on('command.run', async (_$, e) => {
    world.ran.push(e.command)
    if (setup.stackRunFails === true) throw new Error('refused')
    return { text: '' } as never
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  const panes = new Map<string, string>()
  on('ui.open', async (_$, e) => {
    world.opened.push(`${e.id}:${e.title ?? ''}`)
    world.columns.push(e.columns)
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
    const { Box, Text } = $.ui.resolve(e)
    if (setup.slot !== true) return <Text>HOST-AND-OTHERS</Text>
    return (
      <Box flexDirection="column">
        <Box key="side-stack:other-above">
          <Text>OTHER-ABOVE</Text>
        </Box>
        <Box key="side-stack:slot:plan-checklist" />
        <Box key="side-stack:other-below">
          <Text>OTHER-BELOW</Text>
        </Box>
      </Box>
    )
  })
  await $.session.start({ cwd: '/work', surface: setup.surface ?? 'terminal', isInteractive: true })
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

async function paneTexts($: Engine, pane: typeof OWN_PANE | typeof STACK_PANE, surface: Surface): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'plan-checklist', surface, ...pane })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  return texts
}

for (const surface of SURFACES) {
 describe(surface, () => {
  describe('plan_steps', () => {
    test('takes 2 to 8 plain names and refuses fewer or more', async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      const one = await call($, { tool: PLAN, steps: ['Do it all'] })
      expect(one.deny).toContain('2 to 8')
      const nine = await call($, { tool: PLAN, steps: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })
      expect(nine.deny).toContain('2 to 8')
      const ok = await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page in `src/App.tsx`'] })
      expect(ok.result).toBe('Planned 2 steps. The first one has started.')
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
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
      await boot($, on, { surface })
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
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
      expect(all).toContain('Done')
      expect(all).toContain('▶')
      expect(all).toContain('Working')
    })

    test('the turn ending with every step done shows All done, then one line after 5 seconds', async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      await call($, { tool: REPORT, task: 'Build the page', percent: 100 })
      await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
      expect((await paneTexts($, OWN_PANE, surface)).join('\n')).toContain('All done')
      await world.clock.advance(5000)
      const texts = await paneTexts($, OWN_PANE, surface)
      expect(texts.join('\n')).not.toContain('Build the page')
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan · done')
    })
  })

  describe('tab title', () => {
    test('shows progress, then needs you, then done', async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
      await call($, { tool: PLAN, steps: ['One', 'Two', 'Three', 'Four'] })
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan 0/4')
      await call($, { tool: REPORT, task: 'Two', percent: 100 })
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan 2/4')
      await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan · needs you')
      expect((await paneTexts($, OWN_PANE, surface)).join('\n')).toContain('Claude needs your OK to continue')
      await call($, { tool: REPORT, task: 'Four', percent: 100 })
      await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan · done')
    })

    test('a turn that ends early with no question says paused', async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      await $.turn.complete({ answer: 'Waiting.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan · paused')
      expect((await paneTexts($, OWN_PANE, surface)).join('\n')).toContain('Paused')
      expect(planTitle(null)).toBe('Plan')
    })

    test('/checklist reopens the pane', async ($, on) => {
      const world = await boot($, on, { surface })
      const ran = await $.command.run({ command: 'checklist', args: '' } as never)
      expect(JSON.stringify(ran)).toContain('Checklist opened')
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan')
    })
  })

  describe('require_plan_first', () => {
    test('off by default: a tool runs before any plan', async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      const ran = await call($, { tool: 'Bash', command: 'ls' })
      expect(ran.deny).toBeUndefined()
    })

    test('on in the config file: refused before a plan, allowed after', async ($, on) => {
      await boot($, on, { surface, files: { [CONFIG]: JSON.stringify({ require_plan_first: true }) } })
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
      await boot($, on, { surface })
      await startJob($)
      expect((await call($, { tool: 'Bash', command: 'ls' })).deny).toContain('plan_steps')
    })

    test('false in the config file wins over /config', { options: { require_plan_first: true } }, async ($, on) => {
      await boot($, on, { surface, files: { [CONFIG]: JSON.stringify({ require_plan_first: false }) } })
      await startJob($)
      expect((await call($, { tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
    })

    test('the system prompt asks for a plan, and names the rule only when it is on', async ($, on) => {
      on('prompt.compose', async () => ({ sections: [] }))
      await boot($, on, { surface, files: { [CONFIG]: JSON.stringify({ require_plan_first: true }) } })
      const req = { model: 'claude-test', promptModel: 'claude-test', surfaces: [surface], tools: [], outputStyle: null, traits: [] } as never
      const text = (await $.prompt.compose(req)).sections.find(s => s.id === 'plan-checklist:guide')?.text ?? ''
      expect(text).toContain('plan_steps')
      expect(text).toContain('report_progress')
      expect(text).toContain('Other tools are refused')
    })
  })

  describe('config file', () => {
    test('the first session writes it with null keys', async ($, on) => {
      const world = await boot($, on, { surface })
      expect(world.writes).toEqual([{ path: CONFIG, text: CONFIG_EXAMPLE }])
      expect(JSON.parse(CONFIG_EXAMPLE).require_plan_first).toBe(null)
    })

    test('a file that is there is never rewritten', async ($, on) => {
      const world = await boot($, on, { surface, files: { [CONFIG]: '{ "require_plan_first": true }' } })
      await $.session.start({ cwd: '/work', surface, isInteractive: true })
      expect(world.writes).toEqual([])
    })
  })

  describe('side-stack', () => {
    test('alone: own pane with the checklist', async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
      expect(all).toContain('Read your notes')
    })

    test('with the host: no own pane, a "Plan 1/2" section above the other sections', { plugins: [HOST] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      await call($, { tool: REPORT, task: 'Read your notes', percent: 100 })
      expect(world.opened.filter(one => one.startsWith('plan-checklist:'))).toEqual([])
      const ran = await $.command.run({ command: 'checklist', args: '' } as never)
      expect(JSON.stringify(ran)).toContain('Stack pane')
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
      const world = await boot($, on, { surface })
      await $.command.run({ command: 'checklist', args: '' } as never)
      expect(world.opened.at(-1)).toBe('plan-checklist:Plan')
      await world.clock.advance(1200)
      expect(world.closed).toEqual(['plan-checklist'])
    })
  })

  describe('review fixes', () => {
    test('a side-stack flag with no /stack command is stale: own pane, full list', { plugins: [STALE_HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
      expect((await paneTexts($, OWN_PANE, surface)).join('\n')).toContain('Read your notes')
      expect(await stackedFlag($)).toBe('false')
    })

    test('stacked: a new plan and /checklist run /stack; stacked is published; the own pane shows one line', { plugins: [HOST, READER] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await world.clock.advance(1)
      expect(world.ran).toEqual(['stack'])
      expect(await stackedFlag($)).toBe('true')
      await $.command.run({ command: 'checklist', args: '' } as never)
      await world.clock.advance(1)
      expect(world.ran).toEqual(['stack', 'stack'])
      expect(world.opened.filter(one => one.startsWith('plan-checklist:'))).toEqual([])
      expect(await paneTexts($, OWN_PANE, surface)).toEqual(['Shown in the Stack pane (/stack)'])
    })

    test('from Remote Control a new plan does not run /stack; /checklist still does', { plugins: [HOST, READER] }, async ($, on) => {
      on('prompt.submit', async (_$, e) => ({ text: e.text }))
      const world = await boot($, on, { surface })
      await $.prompt.submit({ text: 'Build my landing page', origin: { kind: 'bridge' } } as never)
      await startJob($)
      await world.clock.advance(1)
      expect(world.ran).toEqual([])
      await $.command.run({ command: 'checklist', args: '' } as never)
      await world.clock.advance(1)
      expect(world.ran).toEqual(['stack'])
    })

    test('a prompt typed here after one from Remote Control runs /stack again', { plugins: [HOST, READER] }, async ($, on) => {
      on('prompt.submit', async (_$, e) => ({ text: e.text }))
      const world = await boot($, on, { surface })
      await $.prompt.submit({ text: 'from the phone', origin: { kind: 'bridge' } } as never)
      await $.prompt.submit({ text: 'Build my landing page', origin: { kind: 'composer' } } as never)
      await startJob($)
      await world.clock.advance(1)
      expect(world.ran).toEqual(['stack'])
    })

    test('stacked but /stack is refused: the own pane shows the full checklist', { plugins: [HOST] }, async ($, on) => {
      const world = await boot($, on, { surface, stackRunFails: true })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      await world.clock.advance(1)
      expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
      expect((await paneTexts($, OWN_PANE, surface)).join('\n')).toContain('Build the page')
    })

    test('report_progress with an unknown or empty name is refused, lists the plan and ticks nothing', async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page', 'Check it works'] })
      const unknown = await call($, { tool: REPORT, task: 'Deploy everything', percent: 100 })
      expect(unknown.deny).toContain('"Read your notes", "Build the page", "Check it works"')
      const empty = await call($, { tool: REPORT, task: '', percent: 50 })
      expect(empty.deny).toContain('"Build the page"')
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
      expect(all).not.toContain('Done')
      expect(all).not.toContain('Deploy everything')
    })

    test('report_progress before any plan is refused', async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      expect((await call($, { tool: REPORT, task: 'Anything', percent: 10 })).deny).toContain('plan_steps first')
    })

    test('every open and retitle keeps the pane width', async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['One', 'Two'] })
      await call($, { tool: REPORT, task: 'One', percent: 100 })
      expect(world.opened.length > 1).toBe(true)
      expect(world.columns.every(c => c === 46)).toBe(true)
    })

    test("a subagent's plan tools are answered and change nothing", async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      const plan = await call($, { tool: PLAN, steps: ['Sub one', 'Sub two'], agentId: 'a1' })
      const report = await call($, { tool: REPORT, task: 'Sub one', percent: 100, agentId: 'a1' })
      expect(String(plan.result)).toContain('Only the main conversation')
      expect(String(report.result)).toContain('Only the main conversation')
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
      expect(all).toContain('Read your notes')
      expect(all).not.toContain('Sub one')
    })

    test('side-stack turning up after the own pane opened: the next change closes it', { plugins: [LATE_HOST] }, async ($, on) => {
      const world = await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      expect(world.opened.some(one => one.startsWith('plan-checklist:'))).toBe(true)
      await world.clock.advance(600)
      expect(world.closed).toEqual([])
      await call($, { tool: REPORT, task: 'Read your notes', percent: 50 })
      expect(world.closed).toEqual(['plan-checklist'])
    })

    test('with require_plan_first on, the assumptions-pane note tool still runs before a plan', { options: { require_plan_first: true } }, async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      expect((await call($, { tool: 'mcp__assumptions-pane__log_assumption', assumption: 'x' })).deny).toBeUndefined()
      expect((await call($, { tool: 'Bash', command: 'ls' })).deny).toContain('plan_steps')
    })

    test('two steps that read the same once cleaned are refused', async ($, on) => {
      await boot($, on, { surface })
      await startJob($)
      const twice = await call($, { tool: PLAN, steps: ['Update `a.ts`', 'Update b.ts', 'Ship it'] })
      expect(twice.deny).toContain('read the same')
    })

    test('a config change mid-session waits for the next session: gate and prompt stay as they started', async ($, on) => {
      on('prompt.compose', async () => ({ sections: [] }))
      const files: Record<string, string> = { [CONFIG]: JSON.stringify({ require_plan_first: false }) }
      await boot($, on, { surface, files })
      files[CONFIG] = JSON.stringify({ require_plan_first: true })
      await startJob($)
      expect((await call($, { tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
      const req = { model: 'claude-test', promptModel: 'claude-test', surfaces: [surface], tools: [], outputStyle: null, traits: [] } as never
      const text = (await $.prompt.compose(req)).sections.find(s => s.id === 'plan-checklist:guide')?.text ?? ''
      expect(text).not.toContain('Other tools are refused')
    })

    test('/clear empties the checklist', async ($, on) => {
      on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
      await boot($, on, { surface })
      await startJob($)
      await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
      const all = (await paneTexts($, OWN_PANE, surface)).join('\n')
      expect(all).toContain('No plan yet.')
      expect(all).not.toContain('Read your notes')
    })
  })

    describe('after /clear (protocol v3)', () => {
      test('the /stack command alone means side-stack is there', { plugins: [COMMAND_ONLY_HOST, READER] }, async ($, on) => {
        const world = await boot($, on, { surface })
        await startJob($)
        await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
        expect(world.opened.filter(one => one.startsWith('plan-checklist:'))).toEqual([])
        expect(await stackedFlag($)).toBe('true')
        expect((await paneTexts($, STACK_PANE, surface))[0]).toBe('Plan 0/2')
      })

      test('/clear, new session id, no session.start, a prompt: the plan is back in the stack', { plugins: [COMMAND_ONLY_HOST, READER] }, async ($, on) => {
        let sid = 's1'
        on('session.id', async () => ({ value: sid }) as never)
        on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
        const world = await boot($, on, { surface })
        await startJob($)
        await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
        await paneTexts($, STACK_PANE, surface)
        await world.clock.advance(1)
        const runsBefore = world.ran.filter(c => c === 'stack').length
        await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
        sid = 's2'
        await $.turn.start({ text: 'Now add a footer', turnId: 't2' })
        await call($, { tool: PLAN, steps: ['Write the footer', 'Check it'] })
        await world.clock.advance(1)
        expect(world.ran.filter(c => c === 'stack').length > runsBefore).toBe(true)
        expect(await stackedFlag($)).toBe('true')
        expect(world.opened.filter(one => one.startsWith('plan-checklist:'))).toEqual([])
        const texts = await paneTexts($, STACK_PANE, surface)
        expect(texts[0]).toBe('Plan 0/2')
        expect(texts.join('\n')).toContain('Write the footer')
        expect(texts.join('\n')).not.toContain('Read your notes')
        expect(texts.some(t => t.includes('HOST-AND-OTHERS'))).toBe(true)
      })
    })

    describe('section order (protocol v4)', () => {
      test('side-stack leaves a slot: the section fills it, between the others', { plugins: [HOST] }, async ($, on) => {
        const world = await boot($, on, { surface, slot: true })
        await startJob($)
        await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
        expect(world.opened.filter(one => one.startsWith('plan-checklist:'))).toEqual([])
        const texts = await paneTexts($, STACK_PANE, surface)
        const above = texts.indexOf('OTHER-ABOVE')
        const heading = texts.indexOf('Plan 0/2')
        const below = texts.indexOf('OTHER-BELOW')
        expect(above).toBe(0)
        expect(heading > above).toBe(true)
        expect(below > heading).toBe(true)
        expect(texts.filter(t => t === 'Plan 0/2').length).toBe(1)
        const ui = await $.ui.mount({ plugin: 'plan-checklist', surface, ...STACK_PANE })
        expect(await ui.find({ key: 'side-stack:plan-checklist' })).toBeDefined()
        expect(await ui.find({ key: 'side-stack:slot:plan-checklist' })).toBeUndefined()
        await ui.unmount()
      })

      test('no slot: the keyed section goes on top, as before', { plugins: [HOST] }, async ($, on) => {
        await boot($, on, { surface })
        await startJob($)
        await call($, { tool: PLAN, steps: ['Read your notes', 'Build the page'] })
        const texts = await paneTexts($, STACK_PANE, surface)
        expect(texts[0]).toBe('Plan 0/2')
        expect(texts.indexOf('HOST-AND-OTHERS') > 0).toBe(true)
        const ui = await $.ui.mount({ plugin: 'plan-checklist', surface, ...STACK_PANE })
        expect(await ui.find({ key: 'side-stack:plan-checklist' })).toBeDefined()
        await ui.unmount()
      })
    })
 })
}
