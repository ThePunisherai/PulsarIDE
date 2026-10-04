/**
 * A project stays one folder: a command or write that would create (or fill) a
 * copy, worktree or "-vNNN-dev" folder NEXT TO a tracked project is refused,
 * with the reason, unless the user asked for one in this chat.
 *
 * Wired on the hook every agent passes a tool call through before running it:
 *  - Claude Code `PreToolUse` on Bash / PowerShell / Write / Edit / MultiEdit;
 *  - Codex `PreToolUse` on `Bash|apply_patch` (codex-rs/hooks: the matcher is a
 *    regex, deny is hookSpecificOutput.permissionDecision, as in Claude Code);
 *  - Qwen Code `PreToolUse` and Gemini CLI `BeforeTool` on run_shell_command /
 *    write_file / replace (Gemini answers `{ decision: "deny", reason }`).
 * The rules are in tracker/mcp/sibling-guard.mjs. Every failure lets the call
 * through: a guard must never be the thing that breaks a session.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  if (!cwd) return
  const here = dirname(fileURLToPath(import.meta.url))
  const mcp = join(here, '..', 'tracker', 'mcp')
  const guard = await import(pathToFileURL(join(mcp, 'sibling-guard.mjs')).href)
  const root = guard.projectRootOf(cwd)
  if (!root) return
  const target = guard.siblingInToolCall(payload.tool_name, payload.tool_input, root, cwd)
  if (!target) return
  // The user asked for a copy, a worktree or a new folder in this chat: theirs.
  const ss = await import(pathToFileURL(join(mcp, 'sessions.mjs')).href)
  const session = String(payload.session_id ?? payload.sessionId ?? '')
  if (session && ss.readSession(root, session)?.asked_copy) return
  const reason = guard.siblingReason(target, root)
  const out =
    event === 'BeforeTool'
      ? { decision: 'deny', reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
  process.stdout.write(`${JSON.stringify(out)}\n`)
}

// A closed pipe on the agent's side must not turn into a crash and an exit code.
process.stdout.on('error', () => {})
try {
  await main()
} catch (err) {
  // The launcher sends stderr to hooks/hook-errors.log; the call goes through.
  process.stderr.write(`[project-guard] ${new Date().toISOString()} ${err?.stack || err}\n`)
}
