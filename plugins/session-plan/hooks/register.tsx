import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage, ToolUseSummary } from 'claude-code'

import type { Plan, PlanItem, PlanStatus } from '../types'

const PANE = 'session-plan'
const TITLE = 'Plan'
const COMMAND = 'progress'
// A small, fast model keeps each update cheap. Each update reads only the new activity.
const MODEL = 'haiku'
const PANE_COLUMNS = 46
const MAX_ITEMS = 14
// The digest one update sends, at most. A longer one keeps its head and its tail.
const MAX_DIGEST = 120_000
const DIGEST_HEAD = 15_000
const KEEP_SESSIONS = 40

const plan = atom({ plugin: 'session-plan', key: 'plan' } as const, null as Plan | null)
const seen = atom({ plugin: 'session-plan', key: 'seen' } as const, 0)
const isRefreshing = atom({ plugin: 'session-plan', key: 'isRefreshing' } as const, false)
const failure = atom({ plugin: 'session-plan', key: 'error' } as const, null as string | null)
const hideDone = atom({ plugin: 'session-plan', key: 'hideDone' } as const, false)

const STATUSES: readonly PlanStatus[] = ['done', 'active', 'todo', 'blocked']

const SYSTEM = `You keep a short, high-level plan for a long interactive coding session between a person and an AI coding agent. The person reads it in a side panel to remember what the session set out to do, what is done, and what is left.

Rules:
- goal: one sentence, 15 words or fewer, naming the overall aim of the session. Change it only when the person changes direction.
- items: 3 to 12 high-level tasks, in the order they were started or planned. Each is 10 words or fewer, starts with a verb, and names an outcome, not a tool call. Fold small steps into their parent task.
- status: "done" (finished), "active" (worked on now; two at most), "todo" (asked for or promised but not started, including follow-ups the agent offered and the person accepted), "blocked" (waiting on the person or on something outside; name what).
- Keep the done items of the previous plan, unless you fold them together. Drop an unfinished item only when the person dropped it.
- Use the session's own short names for things: ticket IDs, PR numbers, file names.

Answer with JSON alone, no prose and no code fence:
{"goal": string, "items": [{"text": string, "status": "done" | "active" | "todo" | "blocked"}]}`

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const LOCAL_COMMAND = /<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/g
const COMMAND_TAGS = /<\/?command-(?:name|message|args)>/g
const TOOL_HINTS = ['file_path', 'path', 'command', 'pattern', 'url', 'subject', 'description', 'query', 'prompt']

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)} …` : text
}

function oneLine(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function clean(text: string) {
  return text.replace(REMINDER, '').replace(LOCAL_COMMAND, '').replace(COMMAND_TAGS, ' ').trim()
}

function describeTool(use: ToolUseSummary) {
  const input = use.input
  const mark = use.isError ? ' FAILED' : ''
  if (use.tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const todos = (input.todos as { content?: unknown; status?: unknown }[])
      .map(todo => `[${todo.status === 'completed' ? 'x' : todo.status === 'in_progress' ? '>' : ' '}] ${String(todo.content ?? '')}`)
      .join('; ')
    return `TodoWrite(${clip(todos, 1500)})`
  }
  if (use.tool === 'TaskUpdate' && typeof input.status === 'string') {
    return `TaskUpdate(#${String(input.taskId ?? '?')} ${input.status})${mark}`
  }
  const hint = TOOL_HINTS.map(key => input[key]).find(value => typeof value === 'string')
  return typeof hint === 'string' ? `${use.tool}(${clip(oneLine(hint), 90)})${mark}` : `${use.tool}${mark}`
}

/** The session activity in `messages` as plain lines for the summarizing model. */
export function digest(messages: readonly SessionMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    const text = clean(message.text)
    if (message.role === 'user') {
      if (text !== '') lines.push(`PERSON: ${clip(text, 2500)}`)
      continue
    }
    if (text !== '') lines.push(`AGENT: ${clip(text, 1500)}`)
    if (message.toolUses.length > 0) lines.push(`TOOLS: ${message.toolUses.map(describeTool).join(', ')}`)
  }
  const all = lines.join('\n')
  if (all.length <= MAX_DIGEST) return all

  return `${all.slice(0, DIGEST_HEAD)}\n[… earlier activity left out …]\n${all.slice(-(MAX_DIGEST - DIGEST_HEAD))}`
}

/** Reads the model's reply as a plan, or undefined when it is not one. */
export function parsePlan(text: string): Omit<Plan, 'turn'> | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const { goal, items } = raw as { goal?: unknown; items?: unknown }
  if (typeof goal !== 'string' || !Array.isArray(items)) return undefined
  const valid: PlanItem[] = []
  for (const item of items as { text?: unknown; status?: unknown }[]) {
    if (typeof item?.text !== 'string' || item.text.trim() === '') continue
    const status = STATUSES.find(one => one === item.status) ?? 'todo'
    valid.push({ text: clip(oneLine(item.text), 140), status })
  }

  return { goal: clip(oneLine(goal), 200), items: valid.slice(0, MAX_ITEMS) }
}

function ask(previous: Plan | null, activity: string, isFull: boolean) {
  const before = previous === null ? 'none' : JSON.stringify({ goal: previous.goal, items: previous.items })
  const heading = isFull
    ? 'The whole session so far (the previous plan may be stale; rebuild it from this):'
    : 'New session activity since that plan:'

  return `Previous plan:\n${before}\n\n${heading}\n<activity>\n${activity}\n</activity>\n\nReturn the updated plan as JSON.`
}

/** The one-line summary for the hint line under the prompt, or undefined with no plan. */
export function statusLine(current: Plan | null): string | undefined {
  if (current === null || current.items.length === 0) return undefined
  const done = current.items.filter(item => item.status === 'done').length
  const head = `plan ${done}/${current.items.length}`
  const active = current.items.find(item => item.status === 'active')
  if (active !== undefined) return `${head} · now: ${clip(active.text, 60)}`
  const todo = current.items.find(item => item.status === 'todo' || item.status === 'blocked')
  if (todo !== undefined) return `${head} · next: ${clip(todo.text, 60)}`

  return `${head} done`
}

async function storeKey($: EngineInterface) {
  return `plan:${await $.session.id()}`
}

async function persist($: EngineInterface, current: Plan, count: number) {
  const key = await storeKey($)
  await $.store.set(key, { plan: current, seen: count })
  const keys = (await $.store.keys()).filter(one => one.startsWith('plan:') && one !== key)
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_SESSIONS + 1))) await $.store.delete(old)
}

let running: Promise<void> | undefined
let queued: 'delta' | 'full' | undefined

async function run($: EngineInterface, mode: 'delta' | 'full') {
  const messages = await $.session.messages()
  const previous = await read($, plan)
  const from = mode === 'full' ? 0 : await read($, seen)
  // A compaction or a rewind leaves fewer messages than the plan read. Read them all again.
  const isFull = mode === 'full' || from > messages.length
  const activity = digest(messages.slice(isFull ? 0 : from))
  if (activity === '') {
    await update($, seen, () => messages.length)
    return
  }

  await update($, isRefreshing, () => true)
  try {
    const reply = await $.model.complete({
      model: MODEL,
      system: SYSTEM,
      prompt: ask(previous, activity, isFull),
      maxTokens: 2000,
      effort: 'low',
      timeoutMs: 90_000,
    })
    if (!reply.isAnswered) {
      await update($, failure, () => (reply.reason === 'api-error' ? `API error ${reply.status}` : reply.reason))
      return
    }
    const parsed = parsePlan(reply.text)
    if (parsed === undefined) {
      await update($, failure, () => 'the model did not answer with a plan')
      return
    }
    const next: Plan = { ...parsed, turn: await $.session.turns() }
    await update($, plan, () => next)
    await update($, seen, () => messages.length)
    await update($, failure, () => null)
    await persist($, next, messages.length).catch(() => undefined)
  } catch (error) {
    await update($, failure, () => (error instanceof Error ? error.message : String(error)))
  } finally {
    await update($, isRefreshing, () => false)
  }
}

function refresh($: EngineInterface, mode: 'delta' | 'full'): Promise<void> {
  if (running !== undefined) {
    queued = mode === 'full' || queued === 'full' ? 'full' : 'delta'
    return running
  }
  running = run($, mode).finally(() => {
    running = undefined
    const again = queued
    queued = undefined
    if (again !== undefined) void refresh($, again)
  })

  return running
}

// Runs the update on a timer of its own, so no turn, command or press waits for the model.
function later($: EngineInterface, mode: 'delta' | 'full') {
  $.clock.after(0, () => void refresh($, mode))
}

async function isOpen($: EngineInterface) {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

const GLYPH: Record<PlanStatus, string> = { active: '▶', todo: '○', blocked: '!', done: '✓' }
const COLOR: Record<PlanStatus, 'claude' | 'subtle' | 'warning' | 'success'> = {
  active: 'claude',
  todo: 'subtle',
  blocked: 'warning',
  done: 'success',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'progress',
      description: 'Toggle the session plan pane (`/progress refresh` rebuilds it, `/progress clear` resets it)',
      argumentHint: '[refresh|clear]',
    })
    // Earlier versions pinned a status entry. The hint line replaces it.
    $.ui.status(undefined)
    if ((await read($, plan)) === null) {
      const saved = (await $.store.get(await storeKey($))) as { plan?: Plan; seen?: number } | undefined
      if (saved?.plan !== undefined) {
        await update($, plan, () => saved.plan ?? null)
        await update($, seen, () => saved.seen ?? 0)
      }
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, plan, () => null)
      await update($, seen, () => 0)
      await update($, failure, () => null)
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && !e.isAborted) later($, 'delta')

    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'refresh') {
      later($, 'full')
      return { text: 'Rebuilding the session plan from the whole transcript.' }
    }
    if (arg === 'clear') {
      await update($, plan, () => null)
      await update($, seen, () => 0)
      await update($, failure, () => null)
      return { text: 'Session plan cleared. It starts again after the next turn.' }
    }
    if (arg !== '') return { text: `Unknown argument "${arg}". Use /${COMMAND}, /${COMMAND} refresh, or /${COMMAND} clear.` }

    if (await isOpen($)) {
      await $.ui.close({ id: PANE })
      return { text: 'Plan pane closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    if ((await read($, plan)) === null && !(await read($, isRefreshing))) later($, 'full')

    return { text: opened.isPlaced ? 'Plan pane opened.' : `Plan pane is waiting for room: ${opened.reason}` }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const line = statusLine(await read($, plan))
    if (line === undefined) return next(e)

    return next({ ...e, props: { ...e.props, tail: `${e.props.tail ?? ''} · ${line}` } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, plan)
    const busy = await read($, isRefreshing)
    const problem = await read($, failure)
    const hide = await read($, hideDone)

    const row = (item: PlanItem) => (
      <Box flexDirection="row">
        <Text color={COLOR[item.status]}>{GLYPH[item.status]} </Text>
        <Box flexShrink={1}>
          <Text wrap="wrap" dimColor={item.status === 'done'}>
            {item.text}
          </Text>
        </Box>
      </Box>
    )
    const section = (label: string, items: PlanItem[]) =>
      items.length === 0 ? null : (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            {label}
          </Text>
          {items.map(row)}
        </Box>
      )

    const items = current?.items ?? []
    const pick = (status: PlanStatus) => items.filter(item => item.status === status)
    const done = pick('done')

    return (
      <Box flexDirection="column">
        {current === null ? (
          <Text dimColor wrap="wrap">
            {busy ? 'Building the plan…' : `No plan yet. It fills in after the next turn, or run /${COMMAND} refresh.`}
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text bold wrap="wrap">
              {current.goal}
            </Text>
            <Text dimColor>
              {done.length}/{items.length} done · prompt {current.turn}
              {busy ? ' · updating…' : ''}
            </Text>
            {section('Now', pick('active'))}
            {section('Blocked', pick('blocked'))}
            {section('Next', pick('todo'))}
            {hide ? (
              done.length === 0 ? null : (
                <Box marginTop={1}>
                  <Text dimColor>✓ {done.length} done (hidden)</Text>
                </Box>
              )
            ) : (
              section('Done', done)
            )}
          </Box>
        )}
        {problem !== null && (
          <Box marginTop={1}>
            <Text color="error" wrap="wrap">
              Last update failed: {problem}
            </Text>
          </Box>
        )}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button key="refresh" label={busy ? 'Updating…' : 'Rebuild'} onPress={() => later($, 'full')} />
          <Button key="done" label={hide ? 'Show done' : 'Hide done'} onPress={() => update($, hideDone, value => !value)} />
        </Box>
      </Box>
    )
  })
}
