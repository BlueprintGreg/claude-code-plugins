import type { RenderPropsOf, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { digest, parsePlan, statusLine } from './register'

const PANE = {
  component: 'Pane' as const,
  requestId: 'session-plan',
  props: {
    title: 'Plan',
    isFocused: false,
    bodyColumns: 46,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  } as RenderPropsOf['Pane'],
}

const REPLY = JSON.stringify({
  goal: 'Ship the membership checkout fix',
  items: [
    { text: 'Find the double-charge cause', status: 'done' },
    { text: 'Fix the idempotency key', status: 'active' },
    { text: 'Open the PR', status: 'todo' },
    { text: 'Wait for the Stripe console change', status: 'blocked' },
  ],
})

test('parsePlan reads a reply, with prose and a bad status around it', async () => {
  const parsed = parsePlan(`Here it is:\n${REPLY.replace('"todo"', '"later"')}\nDone.`)
  expect(parsed?.goal).toBe('Ship the membership checkout fix')
  expect(parsed?.items).toHaveLength(4)
  expect(parsed?.items[2]).toEqual({ text: 'Open the PR', status: 'todo' })
  expect(parsePlan('no json here')).toBeUndefined()
  expect(parsePlan('{"goal": 3}')).toBeUndefined()
})

test('digest keeps prompts, replies and tool hints, and drops reminders', async () => {
  const messages: SessionMessage[] = [
    { role: 'user', text: 'Fix checkout <system-reminder>secret context</system-reminder>', toolUses: [] },
    {
      role: 'assistant',
      text: 'Looking at the handler.',
      toolUses: [
        { tool_use_id: 'a', tool: 'Read', input: { file_path: '/repo/checkout.ts' } },
        {
          tool_use_id: 'b',
          tool: 'TodoWrite',
          input: { todos: [{ content: 'Fix key', status: 'in_progress', activeForm: 'Fixing key' }] },
        },
      ],
    },
    { role: 'user', text: '', toolUses: [] },
  ]
  const text = digest(messages)
  expect(text).toContain('PERSON: Fix checkout')
  expect(text).not.toContain('secret context')
  expect(text).toContain('AGENT: Looking at the handler.')
  expect(text).toContain('Read(/repo/checkout.ts)')
  expect(text).toContain('TodoWrite([>] Fix key)')
})

test('statusLine names the progress and the active item', async () => {
  const plan = { ...parsePlan(REPLY)!, turn: 3 }
  expect(statusLine(plan)).toBe('plan 1/4 · now: Fix the idempotency key')
  expect(statusLine({ ...plan, items: plan.items.filter(item => item.status !== 'active') })).toBe(
    'plan 1/3 · next: Open the PR',
  )
  expect(statusLine(null)).toBeUndefined()
})

test('the pane is empty first, then shows the plan after /progress refresh', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let asked = ''
  let transcript: SessionMessage[] = []
  on('session.messages', () => ({ value: transcript }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.turns', () => ({ value: 3 }))
  on('model.complete', (_$, e) => {
    asked = e.prompt
    return {
      value: {
        isAnswered: true as const,
        text: REPLY,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-plan', surface, ...PANE })
    expect((await ui.find({ type: 'Text', text: /No plan yet/ }))?.text).toContain('/progress refresh')
    await ui.press({ key: 'done' })
    expect((await ui.find({ key: 'done' }))?.text).toContain('Show done')
    await ui.press({ key: 'done' })
    await ui.unmount()
  }

  transcript = [{ role: 'user', text: 'Fix the double charge in checkout', toolUses: [] }]
  await $.command.run({
    command: 'progress',
    args: 'refresh',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await clock.settle()

  expect(asked).toContain('Fix the double charge in checkout')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-plan', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: 'Ship the membership checkout fix' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Fix the idempotency key/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/4 done/ })).toBeDefined()
    await ui.unmount()
  }
})
