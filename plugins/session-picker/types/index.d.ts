export type SessionRow = {
  id: string
  title: string
  mtimeMs: number
  sizeBytes: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-picker': {
      rows: Shaped<SessionRow[]>
      isLoading: boolean
      hasPrompted: boolean
    }
  }
}
