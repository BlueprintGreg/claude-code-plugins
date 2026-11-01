import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SessionRow } from '../types'

const PANE = 'sessions'
const LIMIT = 20
// Change the tag when a row's fields change: it declines what an earlier
// version stored, which outlives a reload.
const rows = atom({ plugin: 'session-picker', key: 'rows' } as const, [], {
  shape: 'rows-1',
})
const isLoading = atom({ plugin: 'session-picker', key: 'isLoading' } as const, false)
const hasPrompted = atom({ plugin: 'session-picker', key: 'hasPrompted' } as const, false)

const TITLE_FIELD = /"(customTitle|aiTitle|lastPrompt)":"((?:[^"\\]|\\.)*)/

function decode(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    // A cut \uXXXX escape: drop the tail and keep the rest readable.
    return raw.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\(.)/g, '$1')
  }
}

function age(mtimeMs: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - mtimeMs) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`

  return `${Math.round(hours / 24)}d`
}

function clip(text: string, width: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > width ? `${line.slice(0, width - 1)}…` : line
}

let projectDir = ''

async function findProjectDir($: EngineInterface) {
  if (projectDir) return projectDir
  const env = await $.process.run(['sh', '-c', 'printf "%s\\n%s" "$HOME" "$CLAUDE_CONFIG_DIR"'])
  const [home, configDir] = env.stdout.split('\n')
  const base = configDir || `${home}/.claude`
  const slug = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-')
  projectDir = `${base}/projects/${slug}`

  return projectDir
}

async function load($: EngineInterface) {
  await update($, isLoading, () => true)
  try {
    const dir = await findProjectDir($)
    const current = await $.session.id()
    const entries = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
    const files = entries
      .filter(f => f.kind === 'file' && f.name.endsWith('.jsonl'))
      .filter(f => f.name !== `${current}.jsonl`)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, LIMIT * 2)
    if (files.length === 0) {
      await update($, rows, () => [])
      return
    }

    const found = await $.process.run([
      'grep',
      '-H',
      '-o',
      '-E',
      '"(customTitle|aiTitle|lastPrompt)":"([^"\\\\]|\\\\.){0,200}',
      ...files.map(f => `${dir}/${f.name}`),
    ])
    const titles = new Map<string, { customTitle?: string; aiTitle?: string; lastPrompt?: string }>()
    for (const line of found.stdout.split('\n')) {
      const cut = line.indexOf('.jsonl:')
      if (cut < 0) continue
      const id = line.slice(line.lastIndexOf('/', cut) + 1, cut)
      const match = TITLE_FIELD.exec(line.slice(cut + 7))
      if (!match) continue
      const kind = match[1] as 'customTitle' | 'aiTitle' | 'lastPrompt'
      const entry = titles.get(id) ?? {}
      entry[kind] = decode(match[2] ?? "")
      titles.set(id, entry)
    }

    const next: SessionRow[] = []
    for (const f of files) {
      const id = f.name.slice(0, -'.jsonl'.length)
      const t = titles.get(id)
      const title = t?.customTitle || t?.aiTitle || t?.lastPrompt
      // A file with no title and no prompt is not a conversation to resume.
      if (!title) continue
      next.push({ id, title, mtimeMs: f.mtimeMs, sizeBytes: f.size })
      if (next.length === LIMIT) break
    }
    await update($, rows, () => next)
  } catch (error) {
    $.ui.log(`session-picker: ${String(error)}`, { to: 'debug' })
    $.ui.toast('Could not read the session list')
  } finally {
    await update($, isLoading, () => false)
  }
}

async function openPane($: EngineInterface) {
  void load($)

  return $.ui.open({ id: PANE, title: 'Recent sessions', focus: true, closeOnEscape: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: 'Show recent sessions in this directory and resume one',
    })
    if ((await $.session.turns()) > 0) {
      await update($, hasPrompted, () => true)
    }

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await openPane($)

    return { text: 'Recent sessions pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, hasPrompted, () => true).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isQuiet = e.props.hasSurvey || e.props.isWorking || (await read($, hasPrompted))
    if (isQuiet) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Button key="open" label="Recent sessions" onPress={() => void openPane($)} />
        <Text dimColor> or type /sessions</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const loading = await read($, isLoading)
    const now = await $.clock.now()
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)
    const width = Math.max(20, (e.viewport?.columns ?? 60) - 12)

    const resume = async (id: string) => {
      await $.ui.close({ id: PANE })
      try {
        await $.command.run({ command: 'resume', args: id })
      } catch (error) {
        $.ui.toast(`Could not resume: ${String(error)}`)
      }
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="refresh" label="Refresh" onPress={() => void load($)} />
          <Text> </Text>
          <Button key="close" label="Close" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
        {loading && list.length === 0 && <Text dimColor>Loading…</Text>}
        {!loading && list.length === 0 && <Text dimColor>No earlier sessions in this directory.</Text>}
        {list.slice(0, room).map((row, i) => (
          <Button
            key={row.id}
            hotkey={i < 9 ? String(i + 1) : undefined}
            plain
            onPress={() => void resume(row.id)}
          >
            {clip(row.title, width)} <Text dimColor>{age(row.mtimeMs, now)}</Text>
          </Button>
        ))}
      </Box>
    )
  })
}
