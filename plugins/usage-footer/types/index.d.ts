export type Usage = {
  week: number | null
  weekResetsAt: string | null
  fiveHour: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-footer': { usage: Usage | null }
  }
}
