import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-07T19:00:00Z')
const LIMITS = [
  { kind: 'seven_day', percentUsed: 89.4, resetsAt: '2026-10-09T01:00:00Z' },
  { kind: 'five_hour', percentUsed: 9, resetsAt: '2026-10-07T22:00:00Z' },
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws usage beside the modes on ${surface}`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('session.measure', (_$, e) => ({ changed: e.changed }))

    await $.session.measure({ context: { window: 1000000 }, rateLimits: LIMITS, changed: ['rateLimits'] })

    const ui = await $.ui.mount({ plugin: 'usage-footer', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    const text = JSON.stringify(await ui.drawn())
    expect(text).toContain('focus')
    expect(text).toContain('week 89%')
    expect(text).toContain('resets in 1d 6h')
    expect(text).toContain('5h 9%')
  })

  test(`passes through before any reading on ${surface}`, async ($, on) => {
    mock.clock(on, { now: NOW })
    on('ui.render', (_$, e) => ({ type: 'Text', props: {}, children: ['engine'] }))
    const ui = await $.ui.mount({ plugin: 'usage-footer', surface, component: 'SessionMode', props: { modes: [] } })
    expect(JSON.stringify(await ui.drawn())).not.toContain('week')
  })
}
