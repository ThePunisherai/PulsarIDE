/**
 * Docs go in docs/: an agent about to write a NEW loose doc at a project's
 * root is told where it belongs instead.
 *
 * "In de toekomst alleen daar aanmaken." Moving loose docs afterwards (the
 * sweep in tracker/mcp/docs-tidy.mjs) keeps a project tidy, but an agent that
 * wrote PLAN.md at the root still thinks it is there. Stopping the write and
 * naming the right place keeps the agent's picture and the disk the same.
 *
 * Wired where the agent's file write passes through a hook that can refuse it:
 * Claude Code `PreToolUse` on `Write` (hookSpecificOutput.permissionDecision
 * "deny" + reason, code.claude.com/docs/en/hooks.md) and Gemini CLI / Qwen Code
 * `BeforeTool` on `write_file` (decision "deny" + reason, docs/hooks/reference.md).
 * Codex writes through apply_patch; its loose docs are caught by the sweep at
 * the next prompt instead.
 *
 * Narrow on purpose: only a new file, only at the root of a project PulsarIDE
 * tracks, only a doc that is not one of the files tools expect at the root
 * (README, CHANGELOG, AGENTS.md, ...). Every failure lets the write through.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

async function main() {
  const raw = readStdin()
  if (!raw.trim()) return
  const payload = JSON.parse(raw)
  const event = String(payload.hook_event_name || '')
  const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() ? resolve(payload.cwd) : ''
  if (!cwd || cwd === resolve(homedir()) || !existsSync(join(cwd, '.planide', 'state.json'))) return
  const input = payload.tool_input ?? {}
  const file = String(input.file_path ?? input.path ?? input.absolute_path ?? '')
  if (!file) return
  const abs = resolve(cwd, file)
  if (existsSync(abs)) return

  const here = dirname(fileURLToPath(import.meta.url))
  const { isLooseDocPath, DOCS_DIR } = await import(
    pathToFileURL(join(here, '..', 'tracker', 'mcp', 'docs-tidy.mjs')).href
  )
  if (!isLooseDocPath(cwd, abs)) return

  const target = join(cwd, DOCS_DIR, basename(abs))
  const reason =
    `PulsarIDE keeps a project's docs in ${DOCS_DIR}/, not loose at the root. Write this to ${target} instead` +
    (existsSync(join(cwd, DOCS_DIR)) ? ` -- and if ${DOCS_DIR}/ already has a doc on this subject, update that one rather than adding another.` : '.') +
    ' README, CHANGELOG, AGENTS.md and the like stay at the root.'
  const out =
    event === 'BeforeTool'
      ? { decision: 'deny', reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}

try {
  await main()
} catch {
  // Never block a write over a tracker problem.
}
