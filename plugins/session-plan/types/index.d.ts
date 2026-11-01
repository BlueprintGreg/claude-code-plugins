export type PlanStatus = 'done' | 'active' | 'todo' | 'blocked'

export type PlanItem = { text: string; status: PlanStatus }

export type Plan = {
  goal: string
  items: PlanItem[]
  // The prompt count when the plan was last updated.
  turn: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-plan': {
      plan: Plan | null
      // How many transcript messages the plan has already read.
      seen: number
      isRefreshing: boolean
      error: string | null
      hideDone: boolean
    }
  }
}
