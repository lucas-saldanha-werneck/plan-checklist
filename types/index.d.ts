// No top-level import or export here: this file stays a global declaration so
// the `declare module` block merges into the API types. The hooks import the
// checklist types from 'claude-code'.
declare module 'claude-code' {
  export type PlanTaskStatus = 'done' | 'active' | 'upcoming'

  export type PlanTask = {
    id: string
    name: string
    status: PlanTaskStatus
    percent: number
    hasReported: boolean
  }

  export type PlanPhase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

  export type PlanChecklist = {
    jobId: number
    title: string
    phase: PlanPhase
    tasks: PlanTask[]
    isPlanned: boolean
    needsYouReason: string | null
    stuckReason: string | null
    startedAt: number
    finishedAt: number | null
    isCollapsed: boolean
  }

  interface PluginState {
    // checklist: the plan on screen. stacked: true while the checklist is drawn
    // as a section of the side-stack pane (side-stack reads it).
    'plan-checklist': { checklist: PlanChecklist | null; stacked: boolean }
    // side-stack's own flag. plan-checklist does not read it (it is session
    // state, gone after /clear); declared so the tests' stand-in host can set it.
    'side-stack': { present: boolean }
  }
}
