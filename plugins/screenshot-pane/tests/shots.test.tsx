import { expect, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'Screenshots',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

test('a PNG that Read opens shows in the pane at its aspect ratio', async ($, on) => {
  on('tool.call', async () => ({ result: {} as never }))
  on('fs.stat', async ($, e) => ({
    value: { kind: 'file', size: 10, mtimeMs: 1000, isLink: false, realPath: e.path },
  }))
  on('process.run', async () => ({
    value: {
      exitCode: 0,
      stdout: 'x\n  pixelWidth: 1600\n  pixelHeight: 800\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))

  await $.tool.call({ tool: 'Read', file_path: '/tmp/shots/page.png' })

  const ui = await $.ui.mount({
    plugin: 'screenshot-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'screenshots',
    props: PANE_PROPS as never,
  })
  const image = await ui.find({ type: 'Image' })
  expect(image).toBeDefined()
  expect(await ui.find({ text: /page\.png/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"columns":80')
  expect(JSON.stringify(await ui.drawn())).toContain('"rows":20')
})

test('an empty pane says so', async ($, on) => {
  const ui = await $.ui.mount({
    plugin: 'screenshot-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'screenshots',
    props: PANE_PROPS as never,
  })
  expect(await ui.find({ text: /No screenshots yet/ })).toBeDefined()
})

test('Bash shows an image the command wrote and skips an old one it only names', async ($, on) => {
  const now = Date.now()
  on('tool.call', async () => ({ result: {} as never, text: 'saved /tmp/shots/new.png' }))
  on('fs.stat', async ($, e) => ({
    value: { kind: 'file', size: 10, mtimeMs: e.path.includes('old') ? now - 60_000 : now, isLink: false, realPath: e.path },
  }))
  on('process.run', async () => ({
    value: { exitCode: 0, stdout: '  pixelWidth: 800\n  pixelHeight: 800\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))

  await $.tool.call({ tool: 'Bash', command: 'agent-browser screenshot --compare /tmp/shots/old.png' })

  const ui = await $.ui.mount({
    plugin: 'screenshot-pane',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'screenshots',
    props: PANE_PROPS as never,
  })
  expect(await ui.find({ text: /1\/1 new\.png/ })).toBeDefined()
  expect(await ui.find({ text: /old\.png/ })).toBeUndefined()
})
