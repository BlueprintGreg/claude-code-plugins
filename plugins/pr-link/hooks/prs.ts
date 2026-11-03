import type { OpenedPr, PrStatus } from '../types'

const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g

// An open PR can change at any time; a merged or closed one rarely does.
const OPEN_FRESH_MS = 2 * 60 * 1000
const DONE_FRESH_MS = 30 * 60 * 1000
const RETRY_MS = 60 * 1000

/** The distinct PR URLs in `output`, in order of first appearance. */
export function findPrUrls(output: string): OpenedPr[] {
  const seen = new Map<string, OpenedPr>()
  for (const m of output.matchAll(PR_URL)) {
    if (!seen.has(m[0])) {
      seen.set(m[0], { url: m[0], repo: m[1] ?? '', number: Number(m[2]) })
    }
  }

  return [...seen.values()]
}

/** The key one PR's status is kept under. */
export const prKey = (pr: OpenedPr) => `${pr.repo}#${pr.number}`

type GhPr = { state?: string; isDraft?: boolean; reviewDecision?: string | null; title?: string }

/** A PrStatus from the JSON of `gh pr view --json state,isDraft,reviewDecision,title`. */
export function toPrStatus(json: string, fetchedAt: number): PrStatus {
  const pr = JSON.parse(json) as GhPr
  const state = pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN'

  return {
    isFound: true,
    state,
    isDraft: pr.isDraft === true,
    reviewDecision: pr.reviewDecision ?? '',
    title: pr.title ?? '',
    fetchedAt,
  }
}

export function isFresh(status: PrStatus | undefined, now = Date.now()): boolean {
  if (!status) {
    return false
  }
  const age = now - status.fetchedAt
  if (!status.isFound) {
    return age < RETRY_MS
  }

  return age < (status.state === 'OPEN' ? OPEN_FRESH_MS : DONE_FRESH_MS)
}

export type Dot = { glyph: string; color?: string; label: string }

/**
 * The circle for one PR. The colours follow GitHub where they can: purple
 * for merged, red for changes requested, green for approved.
 */
export function prDot(status: PrStatus | undefined): Dot {
  if (!status) {
    return { glyph: '●', label: 'loading' }
  }
  if (!status.isFound) {
    return { glyph: '●', label: 'unknown' }
  }
  if (status.state === 'MERGED') {
    return { glyph: '●', color: 'magenta', label: 'merged' }
  }
  if (status.state === 'CLOSED') {
    return { glyph: '●', color: 'gray', label: 'closed' }
  }
  if (status.isDraft) {
    return { glyph: '○', color: 'gray', label: 'draft' }
  }
  if (status.reviewDecision === 'CHANGES_REQUESTED') {
    return { glyph: '●', color: 'red', label: 'changes requested' }
  }
  if (status.reviewDecision === 'APPROVED') {
    return { glyph: '●', color: 'green', label: 'approved' }
  }

  return { glyph: '●', color: 'yellow', label: 'open, waiting for review' }
}
