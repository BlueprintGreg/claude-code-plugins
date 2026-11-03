import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OpenedPr, PrStatus } from '../types'
import { findPrUrls, isFresh, prDot, prKey, toPrStatus } from './prs'

export { findPrUrls } from './prs'

const prs = atom({ plugin: 'pr-link', key: 'prs' } as const, [] as readonly OpenedPr[])
const STATUS = { plugin: 'pr-link', key: 'status' } as const

const CREATE = /\bgh\s+pr\s+create\b/
const SHOWN = 3

const outputOf = (ran: { result?: unknown; text?: string }): string => {
  const result = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
  return [result?.stdout, result?.stderr, ran.text]
    .filter((s): s is string => typeof s === 'string')
    .join('\n')
}

async function fetchStatus($: EngineInterface, pr: OpenedPr): Promise<PrStatus> {
  const fetchedAt = Date.now()
  try {
    const ran = await $.process.run(
      ['gh', 'pr', 'view', pr.url, '--json', 'state,isDraft,reviewDecision,title'],
      { timeoutMs: 20_000 },
    )
    if (ran.exitCode === 0) {
      return toPrStatus(ran.stdout, fetchedAt)
    }

    return { isFound: false, error: ran.stderr.trim().slice(0, 200), fetchedAt }
  } catch (thrown) {
    return { isFound: false, error: String(thrown).slice(0, 200), fetchedAt }
  }
}

// Render hooks may not write state, so they only queue PRs here. A timer
// started at session.start fetches the queue and writes each result.
const wanted = new Map<string, OpenedPr>()
const inFlight = new Set<string>()

async function drain($: EngineInterface) {
  for (const [key, pr] of [...wanted].slice(0, 3)) {
    wanted.delete(key)
    if (inFlight.has(key)) {
      continue
    }
    inFlight.add(key)
    try {
      const { value } = await $.state.get({ ...STATUS, id: key })
      if (!isFresh(value)) {
        await $.state.set({ ...STATUS, id: key }, await fetchStatus($, pr))
      }
    } finally {
      inFlight.delete(key)
    }
  }
}

// Reads each status (subscribing the drawing to it) and queues the ones that
// are missing or stale for the timer to fetch.
async function readStatuses($: EngineInterface, list: readonly OpenedPr[]) {
  const statuses = await Promise.all(list.map(async pr => (await $.state.get({ ...STATUS, id: prKey(pr) })).value))
  list.forEach((pr, index) => {
    if (!isFresh(statuses[index])) {
      wanted.set(prKey(pr), pr)
    }
  })

  return statuses
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, () => {
      if (wanted.size > 0) {
        void drain($)
      }
    })

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined || !CREATE.test(e.command)) {
      return ran
    }

    const found = findPrUrls(outputOf(ran))
    if (found.length > 0) {
      await update($, prs, list => {
        const fresh = found.filter(pr => !list.some(p => p.url === pr.url))
        return [...fresh.reverse(), ...list]
      })
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // An older version could store one URL twice, so drop repeats here too.
    const list = (await read($, prs)).filter((pr, i, all) => all.findIndex(p => p.url === pr.url) === i)

    if (e.props.hasSurvey || list.length === 0) {
      return next(e)
    }

    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const shown = list.slice(0, SHOWN)
    const hidden = list.length - shown.length
    const statuses = await readStatuses($, shown)

    return (
      <Box flexDirection="row">
        <Text>
          <Text dimColor>{shown.length > 1 ? 'PRs opened: ' : 'PR opened: '}</Text>
          {shown.map((pr, i) => {
            const dot = prDot(statuses[i])
            return (
              <Text key={pr.url}>
                {i > 0 ? <Text dimColor>, </Text> : null}
                <Text color={dot.color} dimColor={!dot.color}>{`${dot.glyph} `}</Text>
                <Link href={pr.url}>{`${pr.repo}#${pr.number}`}</Link>
              </Text>
            )
          })}
          {hidden > 0 ? <Text dimColor>{` (+${hidden} more)`}</Text> : null}
          <Text> </Text>
        </Text>
        <Button key="clear" label="Clear" onPress={() => update($, prs, () => [])} />
      </Box>
    )
  })
}
