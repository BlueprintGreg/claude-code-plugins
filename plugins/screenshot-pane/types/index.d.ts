export type Shot = {
  /** The absolute path of the image as found. */
  path: string
  /** The PNG the pane draws: `path` itself, or a converted copy of a JPEG. */
  png: string
  width: number
  height: number
  mtimeMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'screenshot-pane': { shots: Shot[]; pick: number | null }
  }
}
