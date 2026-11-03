export type OpenedPr = { url: string; repo: string; number: number }

export type PrStatus =
  | {
      isFound: true
      state: 'OPEN' | 'MERGED' | 'CLOSED'
      isDraft: boolean
      reviewDecision: string
      title: string
      fetchedAt: number
    }
  | { isFound: false; error: string; fetchedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'pr-link': { prs: readonly OpenedPr[]; status: StateFamily<PrStatus> }
  }
}
