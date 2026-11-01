import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'

const PANE = 'screenshots'
const TITLE = 'Screenshots'
const KEEP = 50
const CACHE = '/tmp/claude-screenshot-pane'
// A terminal cell is about twice as tall as it is wide.
const CELL_ASPECT = 2
// Rows the pane spends on its header and buttons.
const CHROME_ROWS = 3
// A Bash command's image counts when the command wrote it, give or take this.
const CLOCK_SLACK_MS = 2000

const IMAGE = /\.(png|jpe?g)$/i
const PNG = /\.png$/i
const PATHS = /(?:~\/|\.{1,2}\/|\/)?[\w@%+=,.~/-]*[\w-]\.(?:png|jpe?g)\b/gi

const shots = atom({ plugin: 'screenshot-pane', key: 'shots' } as const, [] as Shot[])
const pick = atom({ plugin: 'screenshot-pane', key: 'pick' } as const, null as number | null)

// Set when the person closes the pane, so a new image does not reopen it.
let isDismissed = false
let home: string | undefined

async function expandHome($: EngineInterface, path: string) {
  if (!path.startsWith('~/')) return path
  if (home === undefined) {
    const { stdout } = await $.process.run(['/usr/bin/printenv', 'HOME'])
    home = stdout.trim()
  }
  return `${home}/${path.slice(2)}`
}

async function inspect($: EngineInterface, path: string, mtimeMs: number): Promise<Shot | undefined> {
  let png = path
  if (!PNG.test(path)) {
    const name = path.split('/').pop()?.replace(IMAGE, '') ?? 'image'
    png = `${CACHE}/${Math.round(mtimeMs)}-${name}.png`
    await $.process.run(['/bin/mkdir', '-p', CACHE])
    const converted = await $.process.run(['/usr/bin/sips', '-s', 'format', 'png', path, '--out', png])
    if (converted.exitCode !== 0) return undefined
  }
  const sized = await $.process.run(['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', png])
  const width = Number(/pixelWidth:\s*(\d+)/.exec(sized.stdout)?.[1])
  const height = Number(/pixelHeight:\s*(\d+)/.exec(sized.stdout)?.[1])
  if (!(width > 0 && height > 0)) return undefined

  return { path, png, width, height, mtimeMs }
}

async function capture($: EngineInterface, candidates: string[], newerThanMs: number | undefined) {
  const found: Shot[] = []
  for (const candidate of new Set(candidates)) {
    const stat = await $.fs
      .stat(await expandHome($, candidate), { resolve: true })
      .catch(() => undefined)
    if (stat?.kind !== 'file' || stat.realPath === undefined) continue
    if (newerThanMs !== undefined && stat.mtimeMs < newerThanMs) continue
    const shot = await inspect($, stat.realPath, stat.mtimeMs).catch(() => undefined)
    if (shot !== undefined) found.push(shot)
  }
  if (found.length === 0) return

  const paths = new Set(found.map(shot => shot.path))
  await update($, shots, list => [...list.filter(one => !paths.has(one.path)), ...found].slice(-KEEP))
  await update($, pick, () => null)
  if (!isDismissed) void $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'shots',
      description: 'Show the screenshots pane (`/shots clear` empties it)',
    })

    return next(e)
  })

  on('command.run', { command: 'shots' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, shots, () => [])
      await update($, pick, () => null)

      return { text: 'Screenshots cleared.' }
    }
    isDismissed = false
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return { text: opened.isPlaced ? 'Screenshots pane opened.' : `Screenshots pane waits: ${opened.reason}` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') isDismissed = true

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const startedMs = Date.now()
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (e.tool === 'Read' && IMAGE.test(e.file_path)) {
      void capture($, [e.file_path], undefined).catch(() => undefined)
    } else if (e.tool === 'Bash') {
      const text = `${e.command}\n${ran.text ?? ''}`
      const candidates = text.match(PATHS) ?? []
      if (candidates.length > 0) {
        void capture($, candidates, startedMs - CLOCK_SLACK_MS).catch(() => undefined)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, shots)
    const chosen = await read($, pick)

    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Images draw only in a kitty-graphics terminal (Ghostty, kitty).</Text>
    }
    const { Box, Text, Button, Image } = $.ui.resolve(e)

    if (list.length === 0) {
      return (
        <Text dimColor>
          No screenshots yet. A PNG or JPEG that a tool reads or writes shows here.
        </Text>
      )
    }

    const last = list.length - 1
    const index = chosen === null ? last : Math.min(Math.max(chosen, 0), last)
    const shot = list[index]
    if (shot === undefined) return <Text dimColor>No screenshot at {index + 1}.</Text>
    const name = shot.path.split('/').pop() ?? shot.path

    const roomColumns = Math.max(1, Math.min(255, e.props.bodyColumns))
    const roomRows = Math.max(1, Math.min(255, e.props.scroll.bodyRows - CHROME_ROWS))
    let columns = roomColumns
    let rows = Math.round((columns * shot.height) / shot.width / CELL_ASPECT)
    if (rows > roomRows) {
      rows = roomRows
      columns = Math.round((rows * CELL_ASPECT * shot.width) / shot.height)
    }
    columns = Math.max(1, Math.min(roomColumns, columns))
    rows = Math.max(1, Math.min(roomRows, rows))

    const show = (to: number) => update($, pick, () => (to >= last ? null : Math.max(0, to)))

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-middle">
          {index + 1}/{list.length} {name} <Text dimColor>{shot.width}x{shot.height}</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="prev" hotkey="p" onPress={() => void show(index - 1)}>Prev</Button>
          <Button key="next" hotkey="n" onPress={() => void show(index + 1)}>Next</Button>
          <Button key="open" hotkey="o" onPress={() => void $.process.run(['/usr/bin/open', shot.path])}>
            Open
          </Button>
          <Button key="copy" hotkey="y" onPress={press => void $.ui.copy({ text: shot.path, surface: press.surface })}>
            Copy path
          </Button>
        </Box>
        <Image
          key="shot"
          source={{ file: shot.png, format: 'png', generation: Math.round(shot.mtimeMs) }}
          columns={columns}
          rows={rows}
          alt={`${name} (this terminal cannot draw images)`}
        />
      </Box>
    )
  })
}
