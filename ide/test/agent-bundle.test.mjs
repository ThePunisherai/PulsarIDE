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
const { deployAgentBundle } = await import(MOD)

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

const r1 = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('deploys on first run', r1.deployed === true)
ok('101 team leads', r1.agents === 101)
ok('48 skills incl. orchestration', r1.skills === 48 && existsSync(join(HOME, '.claude/skills/agent-orchestrator/SKILL.md')) && existsSync(join(HOME, '.claude/skills/dispatch/SKILL.md')))
ok('claude/gemini/codex all get the roster', readdirSync(join(HOME, '.claude/agents')).filter(f => f.startsWith('pulsar-')).length === 101 && readdirSync(join(HOME, '.gemini/agents')).length === 101 && readdirSync(join(HOME, '.codex/agents')).filter(f => f.endsWith('.toml')).length === 101)
try { execSync('python3 -c "import tomllib,sys;[tomllib.load(open(f,\'rb\')) for f in sys.argv[1:]]" ' + readdirSync(join(HOME, '.codex/agents')).map(f => join(HOME, '.codex/agents', f)).join(' ')); ok('every codex toml parses', true) } catch { ok('every codex toml parses', false) }
ok('graphify hook wired per project', r1.hookWired === true && existsSync(join(HOME, '.config/pulsaride/hooks/graphify-bootstrap.sh')))
const s1 = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8'))
ok('user hook + agent untouched, our hook added', existsSync(join(HOME, '.claude/agents/my-own.md')) && s1.hooks.SessionStart.some(e => JSON.stringify(e).includes('mine.sh')) && s1.hooks.SessionStart.some(e => JSON.stringify(e).includes('graphify-bootstrap.sh')))

// --- tracker: CLI + package + planide MCP, so agents update the board ------ //
const trackerScript = join(HOME, '.config/pulsaride/tracker/mcp/planide_mcp.py')
ok('tracker deployed (CLI + package + MCP script)', r1.trackerDeployed === true &&
  existsSync(trackerScript) &&
  existsSync(join(HOME, '.config/pulsaride/tracker/plan')) &&
  existsSync(join(HOME, '.config/pulsaride/tracker/planide/store.py')))
const cj1 = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
ok('planide MCP registered at user scope, points at deployed script',
  r1.mcpWired === true && cj1.mcpServers && cj1.mcpServers.planide &&
  cj1.mcpServers.planide.args && cj1.mcpServers.planide.args[0] === trackerScript)
ok('existing ~/.claude.json content preserved (never clobbered)',
  cj1.mcpServers.other && cj1.projects && cj1.projects['/p'])
ok('tracker instruction injected into agent bodies (Claude + Codex)',
  readFileSync(join(HOME, '.claude/agents/pulsar-council.md'), 'utf8').includes('PulsarIDE built-in tracker') &&
  readFileSync(join(HOME, '.codex/agents/pulsar-council.toml'), 'utf8').includes('PulsarIDE built-in tracker'))
// Codex: the MCP is registered as a real [mcp_servers.planide] table, pointing at
// our script, and the user's existing config + AGENTS.md are preserved.
const codexToml = readFileSync(join(HOME, '.codex/config.toml'), 'utf8')
ok('Codex MCP registered ([mcp_servers.planide]) pointing at our script',
  codexToml.includes('[mcp_servers.planide]') && codexToml.includes(trackerScript))
ok('Codex existing config preserved (other server + model key kept)',
  codexToml.includes('[mcp_servers.other]') && codexToml.includes('model = "gpt-5"'))
const codexAgentsMd = readFileSync(join(HOME, '.codex/AGENTS.md'), 'utf8')
ok('Codex AGENTS.md gets orchestrator + tracker block, user content kept',
  codexAgentsMd.includes('orchestrate as The Council first') &&
  codexAgentsMd.includes('ask one clarifying question') &&
  codexAgentsMd.includes('PulsarIDE built-in tracker') && codexAgentsMd.includes('Keep this.'))
ok('Claude + Gemini main-session memory get the same block',
  readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8').includes('orchestrate as The Council first') &&
  readFileSync(join(HOME, '.gemini/GEMINI.md'), 'utf8').includes('orchestrate as The Council first'))
ok('Cursor MCP registered at ~/.cursor/mcp.json',
  JSON.parse(readFileSync(join(HOME, '.cursor/mcp.json'), 'utf8')).mcpServers.planide.args[0] === trackerScript)

const r2 = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('second run is version-gated no-op', r2.deployed === false)
const s2 = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8'))
ok('hook not duplicated', s2.hooks.SessionStart.filter(e => JSON.stringify(e).includes('graphify-bootstrap.sh')).length === 1)

const r3 = deployAgentBundle({ home: HOME, resourcesPath: res, force: true, provisionPyEnv: false })
ok('force redeploys without accumulating', r3.deployed === true && readdirSync(join(HOME, '.claude/agents')).filter(f => f.startsWith('pulsar-')).length === 101 && existsSync(join(HOME, '.claude/agents/my-own.md')))
const cj3 = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
ok('force redeploy keeps planide MCP + preserves other servers + tracker present',
  r3.mcpWired === true && cj3.mcpServers.planide && cj3.mcpServers.other &&
  existsSync(join(HOME, '.config/pulsaride/tracker/plan')))

// Once the self-contained venv exists, the MCP re-points at its python (which
// has fastmcp) instead of the system one. Simulate the venv being ready and
// redeploy — the command must switch to the venv python.
const venvPy = join(HOME, '.config/pulsaride/pyenv/bin/python')
mkdirSync(dirname(venvPy), { recursive: true }); writeFileSync(venvPy, '#!/bin/sh\n')
deployAgentBundle({ home: HOME, resourcesPath: res, force: true, provisionPyEnv: false })
const cj4 = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
ok('MCP re-points at the venv python once it exists', cj4.mcpServers.planide.command === venvPy)

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
