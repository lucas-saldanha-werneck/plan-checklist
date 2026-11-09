export type TaskStatus = 'done' | 'active' | 'upcoming'

export type Task = {
  id: string
  name: string
  status: TaskStatus
  percent: number
  hasReported: boolean
}

export type Phase = 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type Checklist = {
  jobId: number
  title: string
  phase: Phase
  tasks: Task[]
  isPlanned: boolean
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number
  finishedAt: number | null
  isCollapsed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'plan-checklist': { checklist: Checklist | null }
    // Read only: the side-stack host sets this to true when it runs.
    'side-stack': { present: boolean }
  }
}
