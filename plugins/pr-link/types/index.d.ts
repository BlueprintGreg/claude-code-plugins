export type OpenedPr = { url: string; repo: string; number: number }

declare module 'claude-code' {
  interface PluginState {
    'pr-link': { prs: readonly OpenedPr[] }
  }
}
