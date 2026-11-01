import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { OpenedPr } from '../types'

const prs = atom({ plugin: 'pr-link', key: 'prs' } as const, [] as readonly OpenedPr[])

const CREATE = /\bgh\s+pr\s+create\b/
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g
const SHOWN = 3

export const findPrUrls = (output: string): OpenedPr[] =>
  [...output.matchAll(PR_URL)].map(m => ({
    url: m[0],
    repo: m[1] ?? '',
    number: Number(m[2]),
  }))

const outputOf = (ran: { result?: unknown; text?: string }): string => {
  const result = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
  return [result?.stdout, result?.stderr, ran.text]
    .filter((s): s is string => typeof s === 'string')
    .join('\n')
}

export const register: Register = on => {
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
    const list = await read($, prs)

    if (e.props.hasSurvey || list.length === 0) {
      return next(e)
    }

    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const shown = list.slice(0, SHOWN)
    const hidden = list.length - shown.length

    return (
      <Box flexDirection="row">
        <Text>
          <Text dimColor>{shown.length > 1 ? 'PRs opened: ' : 'PR opened: '}</Text>
          {shown.map((pr, i) => (
            <Text key={pr.url}>
              {i > 0 ? <Text dimColor>, </Text> : null}
              <Link href={pr.url}>{`${pr.repo}#${pr.number}`}</Link>
            </Text>
          ))}
          {hidden > 0 ? <Text dimColor>{` (+${hidden} more)`}</Text> : null}
          <Text> </Text>
        </Text>
        <Button key="clear" label="Clear" onPress={() => update($, prs, () => [])} />
      </Box>
    )
  })
}
