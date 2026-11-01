import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

// Plan usage drawn into the footer's mode slot (right side of the
// "bypass permissions" row), so it costs no extra row.
const usage = atom({ plugin: 'usage-footer', key: 'usage' } as const, null)

const toUsage = (limits: readonly SessionRateLimit[]): Usage | null => {
  const week = limits.find(l => l.kind === 'seven_day')
  const five = limits.find(l => l.kind === 'five_hour')
  if (!week && !five) return null

  return {
    week: week ? Math.round(week.percentUsed) : null,
    weekResetsAt: week?.resetsAt ?? null,
    fiveHour: five ? Math.round(five.percentUsed) : null,
  }
}

const colorFor = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')

// Relative, so it does not depend on the sandbox's timezone.
const untilReset = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  return `${mins % 60}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const { rateLimits } = await $.session.usage()
      await update($, usage, () => toUsage(rateLimits))
    } catch {
      // No reading yet; session.measure fills it after the first response.
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, usage, () => toUsage(e.rateLimits))
    }

    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const u = await read($, usage)
    if (!u) return next(e)

    const now = await $.clock.now()
    const { Text } = $.ui.resolve(e)
    const parts = []

    if (e.props.modes.length > 0) {
      parts.push(<Text key="modes" dimColor>{`${e.props.modes.join(' & ')} · `}</Text>)
    }
    if (u.week !== null) {
      parts.push(<Text key="week" color={colorFor(u.week)}>{`week ${u.week}%`}</Text>)
      if (u.weekResetsAt) {
        parts.push(<Text key="reset" dimColor>{` (resets in ${untilReset(u.weekResetsAt, now)})`}</Text>)
      }
    }
    if (u.fiveHour !== null) {
      if (u.week !== null) parts.push(<Text key="sep" dimColor>{' · '}</Text>)
      parts.push(<Text key="five" color={colorFor(u.fiveHour)}>{`5h ${u.fiveHour}%`}</Text>)
    }

    // One Text, not a wrapping Box: a wrapping Box takes the full width and
    // the footer moves it to a row of its own.
    return <Text wrap="wrap">{parts}</Text>
  })
}
