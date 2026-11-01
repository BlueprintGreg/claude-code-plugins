import type { RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { findPrUrls } from './register'

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
