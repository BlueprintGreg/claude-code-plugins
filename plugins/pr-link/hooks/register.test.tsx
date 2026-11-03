import type { RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { findPrUrls } from './register'
import { prDot, toPrStatus } from './prs'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10 } as RenderPropsOf['AbovePrompt'],
}

const URL = 'https://github.com/octo-org/sample-app/pull/2950'

test('findPrUrls reads the repo and number', async () => {
  expect(findPrUrls(`Creating pull request\n${URL}\n`)).toEqual([
    { url: URL, repo: 'octo-org/sample-app', number: 2950 },
  ])
})

test('a gh pr create call puts a link in the band, and Clear removes it', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: `${URL}\n`, stderr: '', interrupted: false },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ plugin: 'pr-link', surface, ...BAND })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()

    await $.tool.call({ tool: 'Bash', command: 'gh pr view 12' })
    ui = await $.ui.mount({ plugin: 'pr-link', surface, ...BAND })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()

    await $.tool.call({ tool: 'Bash', command: 'git push && gh pr create --title x --body y' })
    ui = await $.ui.mount({ plugin: 'pr-link', surface, ...BAND })
    const link = await ui.find({ type: 'Link' })
    expect(link?.props.href).toBe(URL)
    expect(link?.text).toContain('octo-org/sample-app#2950')

    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  }
})

test('findPrUrls drops a URL that gh prints twice', async () => {
  expect(findPrUrls(`${URL}\nWarning: exists ${URL}\n`)).toHaveLength(1)
})

test('prDot colours each PR state', async () => {
  const dot = (json: object) => prDot(toPrStatus(JSON.stringify(json), 0))
  expect(prDot(undefined).color).toBeUndefined()
  expect(dot({ state: 'MERGED', reviewDecision: 'REVIEW_REQUIRED' }).color).toBe('magenta')
  expect(dot({ state: 'CLOSED' }).color).toBe('gray')
  expect(dot({ state: 'OPEN', isDraft: true }).glyph).toBe('○')
  expect(dot({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }).color).toBe('red')
  expect(dot({ state: 'OPEN', reviewDecision: 'APPROVED' }).color).toBe('green')
  expect(dot({ state: 'OPEN', reviewDecision: '' }).color).toBe('yellow')
})

test('the band draws a stored status as a coloured circle', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: `${URL}\n`, stderr: '', interrupted: false },
  }))
  // The hook answers what the host stored: the value and its version.
  const merged = { isFound: true, state: 'MERGED', isDraft: false, reviewDecision: '', title: 'x', fetchedAt: Date.now() }
  on('state.get', ($, e, next) => (e.key === 'status' ? { value: { value: merged, version: 1 } } : next(e)))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x --body y' })
  const ui = await $.ui.mount({ plugin: 'pr-link', surface: 'terminal', ...BAND })
  const dot = await ui.find({ type: 'Text', text: /^● $/ })
  expect(dot?.props.color).toBe('magenta')
  await ui.unmount()
})
