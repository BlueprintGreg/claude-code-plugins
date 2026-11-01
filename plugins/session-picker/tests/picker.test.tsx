import { expect, test } from 'claude-code/testing'

const DIR = '/home/me/.claude/projects/-work'
const PANE = {
  plugin: 'session-picker',
  component: 'Pane',
  requestId: 'sessions',
  surface: 'terminal',
  props: {
    title: 'Recent sessions',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('a row resumes its session', async ($, on) => {
  const ran: { command: string; args: string }[] = []
  on('command.register', () => ({ value: { command: 'sessions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.turns', () => ({ value: 0 }))
  on('session.id', () => ({ value: 'current' }))
  on('session.root', () => ({ value: '/work' }))
  on('clock.now', () => ({ value: 60_000 }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({
    value: [
      { name: 'current.jsonl', kind: 'file', size: 10, mtimeMs: 3, isLink: false },
      { name: 'old.jsonl', kind: 'file', size: 10, mtimeMs: 1, isLink: false },
      { name: 'new.jsonl', kind: 'file', size: 10, mtimeMs: 2, isLink: false },
      { name: 'empty.jsonl', kind: 'file', size: 10, mtimeMs: 2, isLink: false },
    ],
  }))
  on('process.run', (_, e) => {
    const stdout =
      e.argv[0] === 'sh'
        ? '/home/me\n'
        : [
            `${DIR}/new.jsonl:"lastPrompt":"fix the feed"`,
            `${DIR}/new.jsonl:"aiTitle":"Feed fix"`,
            `${DIR}/old.jsonl:"lastPrompt":"say \\"hi\\""`,
          ].join('\n')
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('command.run', (_, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sessions' })

  const ui = await $.ui.mount(PANE)
  const newRow = await ui.find({ type: 'Button', key: 'new' })
  expect(newRow?.text).toMatch(/^Feed fix/)
  const oldRow = await ui.find({ type: 'Button', key: 'old' })
  expect(oldRow?.text).toMatch(/^say "hi"/)
  expect(await ui.find({ type: 'Button', key: 'empty' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'current' })).toBeUndefined()

  await ui.press({ key: 'new' })
  expect(ran.at(-1)).toEqual({ command: 'resume', args: 'new' })
  await ui.unmount()
})
