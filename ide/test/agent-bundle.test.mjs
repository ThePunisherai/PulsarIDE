/**
 * Agent-bundle deploy test: the real module, run against a temp HOME.
 *
 * Bundled with esbuild and executed by ide/verify.sh -- no Electron needed,
 * because the deploy is plain Node fs. PULSAR_REPO points at the repo root so it
 * can find ide/agent-bundle.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.PULSAR_REPO || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOD = process.env.PULSAR_BUNDLE_CJS // esbuild output, provided by verify.sh
const { deployAgentBundle, deployCursorRule } = await import(MOD)

const work = mkdtempSync(join(tmpdir(), 'pulsar-bundle-'))
const res = join(work, 'res'); mkdirSync(res)
symlinkSync(join(REPO, 'ide/agent-bundle'), join(res, 'pulsar-agents'))
const HOME = join(work, 'home'); mkdirSync(HOME)

let pass = 0, fail = 0
const ok = (n, c) => c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n))

mkdirSync(join(HOME, '.claude/agents'), { recursive: true })
writeFileSync(join(HOME, '.claude/agents/my-own.md'), '---\nname: mine\n---\nhi')
writeFileSync(join(HOME, '.claude/settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '/usr/bin/mine.sh' }] }] } }))
// A realistic pre-existing ~/.claude.json (Claude Code's own state): our MCP
// registration must add `planide` without disturbing any of it.
writeFileSync(join(HOME, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } }, projects: { '/p': { allowedTools: [] } } }))
// Pre-existing Codex config + AGENTS.md: our edits must preserve the user's content.
mkdirSync(join(HOME, '.codex'), { recursive: true })
writeFileSync(join(HOME, '.codex/config.toml'), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\nargs = ["y"]\n')
writeFileSync(join(HOME, '.codex/AGENTS.md'), '# My own notes\n\nKeep this.\n')
// Pre-existing Gemini/Antigravity settings.json: registering planide must keep it.
mkdirSync(join(HOME, '.gemini'), { recursive: true })
writeFileSync(join(HOME, '.gemini/settings.json'), JSON.stringify({ theme: 'Default', mcpServers: { other: { command: 'x' } } }))

const r1 = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('deploys on first run', r1.deployed === true)
ok('100 team leads (README excluded)', r1.agents === 100)
ok('48 skills incl. orchestration', r1.skills === 48 && existsSync(join(HOME, '.claude/skills/agent-orchestrator/SKILL.md')) && existsSync(join(HOME, '.claude/skills/dispatch/SKILL.md')))
ok('claude/gemini/codex all get the roster', readdirSync(join(HOME, '.claude/agents')).filter(f => f.startsWith('pulse-')).length === 100 && readdirSync(join(HOME, '.gemini/agents')).length === 100 && readdirSync(join(HOME, '.codex/agents')).filter(f => f.endsWith('.toml')).length === 100)
try { execSync('python3 -c "import tomllib,sys;[tomllib.load(open(f,\'rb\')) for f in sys.argv[1:]]" ' + readdirSync(join(HOME, '.codex/agents')).map(f => join(HOME, '.codex/agents', f)).join(' ')); ok('every codex toml parses', true) } catch { ok('every codex toml parses', false) }
ok('README.md is NOT deployed as an agent (would break Codex agent loading)',
  !existsSync(join(HOME, '.codex/agents/pulse-README.toml')) &&
  !existsSync(join(HOME, '.claude/agents/pulse-README.md')) &&
  !existsSync(join(HOME, '.gemini/agents/pulse-README.md')))
// The persona the user actually sees announce itself.
ok('deployed personas are branded Pulse Agent (no ThePunisher/Pulsar left)', (() => {
  const md = readFileSync(join(HOME, '.claude/agents/pulse-council.md'), 'utf8')
  const toml = readFileSync(join(HOME, '.codex/agents/pulse-council.toml'), 'utf8')
  return md.includes('\u{1F534} Pulse Agent \u2014') && md.includes("Pulse Agent's orchestrator") &&
    !md.includes('ThePunisher') && !/\bPulsar\b(?!IDE)/.test(md) && toml.includes('name = "pulse-council"')
})())
ok('codex toml uses a literal string for instructions (backslash-safe)',
  readFileSync(join(HOME, '.codex/agents/pulse-council.toml'), 'utf8').includes("developer_instructions = '''"))
ok('graphify hook wired per project', r1.hookWired === true && existsSync(join(HOME, '.config/pulsaride/hooks/graphify-bootstrap.sh')))
const s1 = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8'))
ok('user hook + agent untouched, our hook added', existsSync(join(HOME, '.claude/agents/my-own.md')) && s1.hooks.SessionStart.some(e => JSON.stringify(e).includes('mine.sh')) && s1.hooks.SessionStart.some(e => JSON.stringify(e).includes('graphify-bootstrap.sh')))

// --- tracker: CLI + package + planide MCP, so agents update the board ------ //
const trackerScript = join(HOME, '.config/pulsaride/tracker/mcp/planide-mcp.mjs')
ok('tracker deployed (CLI + package + Node MCP server)', r1.trackerDeployed === true &&
  existsSync(trackerScript) &&
  existsSync(join(HOME, '.config/pulsaride/tracker/plan')) &&
  existsSync(join(HOME, '.config/pulsaride/tracker/planide/store.py')))
ok('RE toolkit deployed', existsSync(join(HOME, '.config/pulsaride/tools/reverse-engineering/re-triage.sh')))
const cj1 = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
ok('planide MCP registered at user scope, points at deployed script',
  r1.mcpWired === true && cj1.mcpServers && cj1.mcpServers.planide &&
  cj1.mcpServers.planide.args && cj1.mcpServers.planide.args[0] === trackerScript)
// The whole point of the Node server: it runs under the app's own binary, so it
// needs no Python and no fastmcp -- the reason the tracker did nothing before.
ok('MCP runs under the app binary as node (no Python dependency)',
  cj1.mcpServers.planide.command === process.execPath &&
  cj1.mcpServers.planide.env && cj1.mcpServers.planide.env.ELECTRON_RUN_AS_NODE === '1')
ok('existing ~/.claude.json content preserved (never clobbered)',
  cj1.mcpServers.other && cj1.projects && cj1.projects['/p'])
ok('tracker instruction injected into agent bodies (Claude + Codex)',
  readFileSync(join(HOME, '.claude/agents/pulse-council.md'), 'utf8').includes('PulsarIDE built-in tracker') &&
  readFileSync(join(HOME, '.codex/agents/pulse-council.toml'), 'utf8').includes('PulsarIDE built-in tracker'))
// Codex: the MCP is registered as a real [mcp_servers.planide] table, pointing at
// our script, and the user's existing config + AGENTS.md are preserved.
const codexToml = readFileSync(join(HOME, '.codex/config.toml'), 'utf8')
ok('Codex MCP registered ([mcp_servers.planide]) pointing at our script',
  codexToml.includes('[mcp_servers.planide]') && codexToml.includes(trackerScript))
ok('Codex MCP carries the run-as-node env table',
  codexToml.includes('[mcp_servers.planide.env]') && codexToml.includes('ELECTRON_RUN_AS_NODE = "1"'))
ok('Codex existing config preserved (other server + model key kept)',
  codexToml.includes('[mcp_servers.other]') && codexToml.includes('model = "gpt-5"'))
const codexAgentsMd = readFileSync(join(HOME, '.codex/AGENTS.md'), 'utf8')
ok('Codex AGENTS.md gets orchestrator + tracker block, user content kept',
  codexAgentsMd.includes('orchestrate as The Council') &&
  codexAgentsMd.includes('ask one clarifying question') &&
  codexAgentsMd.includes('planide') && codexAgentsMd.includes('Keep this.'))
// The fix for "I give it a task and nothing appears": putting the request on the
// board is step 2 of every task, before any code -- not a separate optional note.
ok('the main-session block makes the board a Council step, before any code',
  codexAgentsMd.includes('Put it on the board, before you write any code') &&
  codexAgentsMd.includes('get_board') && codexAgentsMd.includes('add_item'))
ok('Claude + Gemini main-session memory get the same block',
  readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8').includes('orchestrate as The Council') &&
  readFileSync(join(HOME, '.gemini/GEMINI.md'), 'utf8').includes('orchestrate as The Council'))
ok('Cursor MCP registered at ~/.cursor/mcp.json',
  JSON.parse(readFileSync(join(HOME, '.cursor/mcp.json'), 'utf8')).mcpServers.planide.args[0] === trackerScript)
const gem1 = JSON.parse(readFileSync(join(HOME, '.gemini/settings.json'), 'utf8'))
ok('Gemini/Antigravity MCP registered at ~/.gemini/settings.json, user content preserved',
  gem1.mcpServers.planide.args[0] === trackerScript && gem1.mcpServers.other && gem1.theme === 'Default')
ok('every agent gets the same dependency-free launch (claude/codex/cursor/gemini)',
  [JSON.parse(readFileSync(join(HOME, '.cursor/mcp.json'), 'utf8')).mcpServers.planide, gem1.mcpServers.planide]
    .every((s) => s.command === process.execPath && s.env?.ELECTRON_RUN_AS_NODE === '1'))

const r2 = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('second run is version-gated no-op', r2.deployed === false)
const s2 = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8'))
ok('hook not duplicated', s2.hooks.SessionStart.filter(e => JSON.stringify(e).includes('graphify-bootstrap.sh')).length === 1)

const r3 = deployAgentBundle({ home: HOME, resourcesPath: res, force: true, provisionPyEnv: false })
ok('force redeploys without accumulating', r3.deployed === true && readdirSync(join(HOME, '.claude/agents')).filter(f => f.startsWith('pulse-')).length === 100 && existsSync(join(HOME, '.claude/agents/my-own.md')))
const cj3 = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
ok('force redeploy keeps planide MCP + preserves other servers + tracker present',
  r3.mcpWired === true && cj3.mcpServers.planide && cj3.mcpServers.other &&
  existsSync(join(HOME, '.config/pulsaride/tracker/plan')))

// A provisioned Python venv must NOT drag the MCP back onto Python: the Node
// server under the app binary is the one that always works, so it stays.
const venvPy = join(HOME, '.config/pulsaride/pyenv/bin/python')
mkdirSync(dirname(venvPy), { recursive: true }); writeFileSync(venvPy, '#!/bin/sh\n')
deployAgentBundle({ home: HOME, resourcesPath: res, force: true, provisionPyEnv: false })
const cj4 = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
ok('a Python venv does not displace the Node MCP server',
  cj4.mcpServers.planide.command === process.execPath && cj4.mcpServers.planide.args[0] === trackerScript)

// --- Antigravity: its own native Skill, not only the shared GEMINI.md block -- //
// Antigravity does not read ~/.gemini/agents/, so without this it saw Pulse
// Agent only through the merged GEMINI.md. Path per ThePunisher-Agent's own
// verified installer.
const skillPath = join(HOME, '.gemini/config/skills/pulse-agent/SKILL.md')
ok('Antigravity native Skill deployed at ~/.gemini/config/skills/pulse-agent/SKILL.md',
  existsSync(skillPath))
const skill = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : ''
ok('Antigravity Skill has the frontmatter Antigravity matches on (name + description)',
  /^---\r?\n/.test(skill) && /\nname:\s*pulse-agent\b/.test(skill) && /\ndescription:/.test(skill))
ok('Antigravity Skill carries the real orchestrator body, not just frontmatter',
  skill.includes('orchestrate as The Council') && skill.includes('get_board'))

// --- Cursor: a project-scoped rule, and ONLY for a tracked project ---------- //
// Cursor has no verified user-scope rules location, so this writes into the
// repo -- which makes "only where a board already exists" the load-bearing part.
const untracked = join(work, 'untracked'); mkdirSync(untracked)
ok('Cursor rule NOT written into a project with no board (never litters a repo)',
  deployCursorRule(untracked, HOME) === false &&
  !existsSync(join(untracked, '.cursor/rules/pulse-agent.mdc')))

const tracked = join(work, 'tracked'); mkdirSync(join(tracked, '.planide'), { recursive: true })
writeFileSync(join(tracked, '.planide/state.json'), '{}')
ok('Cursor rule written for a tracked project', deployCursorRule(tracked, HOME) === true)
const mdc = readFileSync(join(tracked, '.cursor/rules/pulse-agent.mdc'), 'utf8')
ok('Cursor rule is alwaysApply (Cursor has no task routing to discover it otherwise)',
  /^---\r?\n/.test(mdc) && /\nalwaysApply:\s*true\b/.test(mdc))
ok('Cursor rule carries the same orchestrator body the other agents get',
  mdc.includes('orchestrate as The Council') && mdc.includes('get_board'))

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
