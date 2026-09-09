/**
 * Agent-bundle deploy test: the real module, run against a temp HOME.
 *
 * Bundled with esbuild and executed by ide/verify.sh -- no Electron needed,
 * because the deploy is plain Node fs. PULSAR_REPO points at the repo root so it
 * can find ide/agent-bundle.
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = process.env.PULSAR_REPO || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MOD = process.env.PULSAR_BUNDLE_CJS // esbuild output, provided by verify.sh
const {
  deployAgentBundle,
  deployCursorRule,
  deployProjectAgentsMd,
  trackerHealth,
  repairTrackerRegistration,
  eccStatus,
  setEccEnabled
} = await import(MOD)

const work = mkdtempSync(join(tmpdir(), 'pulsar-bundle-'))
const res = join(work, 'res'); mkdirSync(res)
symlinkSync(join(REPO, 'ide/agent-bundle'), join(res, 'pulsar-agents'))
const HOME = join(work, 'home'); mkdirSync(HOME)

// Resolved the way mcpLaunch resolves it, so these assertions hold on a machine
// with node on PATH and on one without -- both are real deployments.
const nodeOnPath = (() => {
  try {
    for (const cand of execSync(process.platform === 'win32' ? 'where node' : 'which -a node')
      .toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (!existsSync(cand)) continue
      const major = Number.parseInt(execSync(`"${cand}" --version`).toString().trim().replace(/^v/, ''), 10)
      if (Number.isFinite(major) && major >= 18) return cand
    }
  } catch {
    /* none -- the app binary is the fallback, which is what mcpLaunch does */
  }
  return null
})()

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
// Same for Qwen Code, which keeps its own ~/.qwen/settings.json.
mkdirSync(join(HOME, '.qwen'), { recursive: true })
writeFileSync(join(HOME, '.qwen/settings.json'), JSON.stringify({ vimMode: true, mcpServers: { other: { command: 'x' } } }))
writeFileSync(join(HOME, '.qwen/QWEN.md'), '# My own Qwen notes\n\nKeep this too.\n')

const r1 = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('deploys on first run', r1.deployed === true)
ok('100 team leads (README excluded)', r1.agents === 100)
// Counted from the bundle rather than written down here: a hardcoded number is
// how the deploy gate went stale in the first place.
const bundledSkills = readdirSync(join(REPO, 'ide/agent-bundle/skills'))
  .filter((d) => existsSync(join(REPO, 'ide/agent-bundle/skills', d, 'SKILL.md'))).length
ok(`every bundled skill deploys (${bundledSkills}), orchestration included`,
  r1.skills === bundledSkills &&
  existsSync(join(HOME, '.claude/skills/agent-orchestrator/SKILL.md')) &&
  existsSync(join(HOME, '.claude/skills/dispatch/SKILL.md')) &&
  existsSync(join(HOME, '.claude/skills/prompt-master/SKILL.md')))
// Qwen Code: same `<dir>/<name>.md` subagent shape as Gemini CLI, under ~/.qwen.
// Paths taken from the published @qwen-code/qwen-code bundle itself
// (QWEN_DIR='.qwen', AGENT_CONFIG_DIR='agents', SKILLS_CONFIG_DIR='skills',
// context filenames ['QWEN.md','AGENTS.md']), not inferred from the fork.
ok('Qwen Code gets the same roster and every bundled skill',
  readdirSync(join(HOME, '.qwen/agents')).filter(f => f.startsWith('pulse-') && f.endsWith('.md')).length === 100 &&
  existsSync(join(HOME, '.qwen/skills/agent-orchestrator/SKILL.md')) &&
  readdirSync(join(HOME, '.qwen/skills')).length === readdirSync(join(HOME, '.claude/skills')).length)
ok('Qwen Code gets the main-session block in ~/.qwen/QWEN.md, own notes intact', (() => {
  const t = readFileSync(join(HOME, '.qwen/QWEN.md'), 'utf8')
  return t.includes('\u{1F534} Pulse Agent \u2014 Council') && t.includes('# My own Qwen notes')
})())
ok('Qwen Code MCP registered at ~/.qwen/settings.json, user content preserved', (() => {
  const q = JSON.parse(readFileSync(join(HOME, '.qwen/settings.json'), 'utf8'))
  return q.mcpServers.planide && q.mcpServers.other && q.vimMode === true
})())
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
// No Python, no fastmcp -- that was the reason the tracker did nothing at all
// once. The runtime is a real `node` when there is one, and the app's own binary
// as node when there is not. A real user's Codex session failing every planide
// call with "Transport closed" is what settled the order: the same deployed
// server, driven by plain node, answered fine -- the ~200 MB Electron binary was
// simply too slow to start before the agent gave up on it.
const launched = cj1.mcpServers.planide
ok('MCP runs on a real node when there is one, the app binary otherwise',
  launched.command === (nodeOnPath ?? process.execPath) &&
  (nodeOnPath ? !launched.env : launched.env?.ELECTRON_RUN_AS_NODE === '1'))
// Whichever it picked has to actually be able to run it. A registered runtime
// that is not there is precisely the failure being fixed.
ok('and that runtime exists and really runs the server', (() => {
  const out = execSync(`"${launched.command}" -e "process.stdout.write('ok')"`, {
    env: { ...process.env, ...(launched.env ?? {}) }
  }).toString()
  return out === 'ok' && existsSync(launched.args[0])
})())
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
ok('Codex gets the env table only when the launch actually needs one',
  nodeOnPath
    ? !codexToml.includes('[mcp_servers.planide.env]')
    : codexToml.includes('[mcp_servers.planide.env]') && codexToml.includes('ELECTRON_RUN_AS_NODE = "1"'))
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
// "It never even gets called": the 100 team-lead subagent files each carry an
// activation-banner rule, but a MAIN session is not a subagent -- and the block
// referred to "the activation banner" without ever telling a main session to
// print one. With no banner there is no evidence any of this reached the model,
// which reads exactly like the agent never ran. Every tool's always-loaded file
// must carry the rule, not just Claude's.
ok('every main session is told to announce itself with the activation banner',
  ['.codex/AGENTS.md', '.claude/CLAUDE.md', '.gemini/GEMINI.md'].every((f) => {
    const s = readFileSync(join(HOME, f), 'utf8')
    return s.includes('🔴 Pulse Agent — Council') && s.includes('before anything else')
  }))
// The mblode/agent-skills library ships as ordinary skills, so the only thing
// that can silently break is them not landing at all.
const deployedSkills = readdirSync(join(HOME, '.claude/skills'))
ok('mblode/agent-skills land as real deployed skills',
  ['ui-design', 'pr-reviewer', 'ax-audit', 'codebase-architecture', 'tidy'].every(
    (s) => deployedSkills.includes(s) &&
      existsSync(join(HOME, '.claude/skills', s, 'SKILL.md'))))
// The watermark instruction has to reach every agent, not just Claude -- an
// invisible mark is invisible regardless of which model wrote the doc.
ok('every agent is told to clean the docs it writes',
  codexAgentsMd.includes('clean_doc') &&
  readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8').includes('clean_doc') &&
  readFileSync(join(HOME, '.gemini/GEMINI.md'), 'utf8').includes('clean_doc'))
ok('Cursor MCP registered at ~/.cursor/mcp.json',
  JSON.parse(readFileSync(join(HOME, '.cursor/mcp.json'), 'utf8')).mcpServers.planide.args[0] === trackerScript)
const gem1 = JSON.parse(readFileSync(join(HOME, '.gemini/settings.json'), 'utf8'))
ok('Gemini/Antigravity MCP registered at ~/.gemini/settings.json, user content preserved',
  gem1.mcpServers.planide.args[0] === trackerScript && gem1.mcpServers.other && gem1.theme === 'Default')
// One launch, every agent. They fail separately otherwise, and a tracker that
// works in one CLI and dies in another is the hardest kind of report to act on.
ok('every agent gets the same dependency-free launch (claude/codex/cursor/gemini)',
  [JSON.parse(readFileSync(join(HOME, '.cursor/mcp.json'), 'utf8')).mcpServers.planide, gem1.mcpServers.planide]
    .every((s) => s.command === launched.command &&
      (s.env?.ELECTRON_RUN_AS_NODE ?? null) === (launched.env?.ELECTRON_RUN_AS_NODE ?? null)))

const r2 = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('second run is version-gated no-op', r2.deployed === false)
const s2 = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8'))
ok('hook not duplicated', s2.hooks.SessionStart.filter(e => JSON.stringify(e).includes('graphify-bootstrap.sh')).length === 1)

// A release can change the main-session instruction WITHOUT changing a single
// file under ide/agent-bundle/ -- v0.57.0's routing table did exactly that, and
// v0.56.0's activation banner lives in the same place. bundleSignature only
// fingerprints the bundle directories, so that release's signature is identical
// and the deploy is correctly gated off. The instruction still has to land, or
// updating the app visibly changes nothing in chat -- which is how it gets
// reported. registerTrackerForAllAgents runs BEFORE the gate for exactly this
// reason; this pins that ordering down so a refactor cannot quietly undo it.
const MAIN_FILES = ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.gemini/GEMINI.md',
  '.qwen/QWEN.md', '.gemini/config/skills/pulse-agent/SKILL.md']
for (const f of MAIN_FILES) {
  // Stand in for the previous build's text: keep the delimiters, gut the body.
  const path = join(HOME, f)
  const t = readFileSync(path, 'utf8')
  writeFileSync(path, t.includes('<!-- PULSAR:MAIN:BEGIN -->')
    ? t.split('<!-- PULSAR:MAIN:BEGIN -->')[0] + '<!-- PULSAR:MAIN:BEGIN -->\nSTALE\n<!-- PULSAR:MAIN:END -->'
    : '---\nname: pulse-agent\n---\nSTALE\n')
}
const rStale = deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
ok('a prompt-only release still refreshes every main session (no signature change)',
  rStale.deployed === false && MAIN_FILES.every((f) => {
    const t = readFileSync(join(HOME, f), 'utf8')
    return !t.includes('STALE') && t.includes('\u{1F534} Pulse Agent \u2014 Council')
  }))
ok("the user's own text around the managed block survives that refresh",
  readFileSync(join(HOME, '.codex/AGENTS.md'), 'utf8').includes('# My own notes'))

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

// --- AGENTS.md: the open format every agent we do NOT wire by name reads ---- //
// Same repo-writing risk as the Cursor rule, so the same board gate. The extra
// thing this one has to get right is that AGENTS.md is a file the user commits:
// their own content has to come back byte for byte, and a second run must
// replace our block rather than append another copy.
ok('AGENTS.md NOT written into a project with no board',
  deployProjectAgentsMd(untracked, HOME) === false && !existsSync(join(untracked, 'AGENTS.md')))
writeFileSync(join(tracked, 'AGENTS.md'), '# Build\n\nRun `make test` first.\n')
ok('AGENTS.md written for a tracked project', deployProjectAgentsMd(tracked, HOME) === true)
const agentsMd = readFileSync(join(tracked, 'AGENTS.md'), 'utf8')
ok("AGENTS.md keeps the repo's own instructions and adds the orchestrator body",
  agentsMd.includes('Run `make test` first.') && agentsMd.includes('orchestrate as The Council') &&
  agentsMd.includes('\u{1F534} Pulse Agent \u2014 Council'))
deployProjectAgentsMd(tracked, HOME)
const agentsMd2 = readFileSync(join(tracked, 'AGENTS.md'), 'utf8')
ok('a second run replaces our AGENTS.md block instead of appending another',
  agentsMd2.split('<!-- PULSAR:MAIN:BEGIN -->').length === 2 && agentsMd2 === agentsMd)

// --- Archify: the whole toolkit, not just render --------------------------- //
// Everything in the artifacts people actually want -- guided views, the summary
// cards, Before/Delta/After -- was already installed and already working. The
// Council was only ever told `render`, so it produced box-and-arrow sketches and
// never the rest. These assert the instruction names the parts that make the
// difference, and asks for them per project instead of waiting to be asked.
const arch = readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8')
ok('the Council is told to deliver at showcase quality, not bare render',
  arch.includes('deliver') && arch.includes('--quality showcase') &&
  arch.includes('9 artifact checks'))
ok('and the fields that carry the rich artifact are named',
  ['meta.quality_profile', 'meta.views', 'cards', 'sublabel'].every((f) => arch.includes(f)))
ok('compare (Before/Delta/After) is reachable, it was never mentioned before',
  arch.includes('compare architecture') && arch.includes('Before / Delta / After'))
ok('and it offers a diagram per project rather than waiting to be asked',
  arch.includes('per project, do not wait to be asked'))

// --- ECC: installed by its own installer, and switchable ------------------- //
// It costs ~40.6k always-on tokens (Claude Code's own plugin details, not an
// estimate), so the guards matter more than the install: it must not run when
// the user said no, and must not retry a failed attempt on every launch.
const eccFresh = eccStatus(HOME)
// Zero, deliberately: the catalogue sits on disk and is reached through
// ecc_find/ecc_read, so it costs nothing until a tool is actually called. The
// 40,637 is what installing the plugin instead would cost -- kept alongside it
// so the trade stays visible rather than becoming folklore.
ok('ECC costs nothing until it is called, and says what the alternative would cost',
  eccFresh.alwaysOnTokens === 0 && eccFresh.alwaysOnTokensIfInstalled === 40637 &&
  eccFresh.installed === false && eccFresh.optedOut === false)
ok('turning ECC off is remembered', setEccEnabled(false, HOME) === true && eccStatus(HOME).optedOut === true)
ok('turning it back on clears the opt-out',
  setEccEnabled(true, HOME) === true && eccStatus(HOME).optedOut === false)
// The plugin marketplace directory is what "installed" means -- taken from the
// real CLI's behaviour on `plugin marketplace add`, checked above too.
ok('once the marketplace is on disk, status says installed',
  (() => {
    mkdirSync(join(HOME, '.claude/plugins/marketplaces/ecc'), { recursive: true })
    return eccStatus(HOME).installed === true
  })())

// --- ECC: named only when it is really installed --------------------------- //
// It is a third-party plugin installed through its own official channel, never
// bundled: 68 more agent descriptions would walk into the same ~15k budget that
// has broken subagents here twice. So the always-loaded block must not pay for
// it -- and must not invite reaching for something that is not on the machine.
ok('ECC is not mentioned when it is not installed',
  !readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8').includes('ecc@ecc'))
// The real path, taken from the Claude Code CLI's own behaviour on `plugin
// marketplace add`, not guessed.
mkdirSync(join(HOME, '.claude/plugins/marketplaces/ecc'), { recursive: true })
deployAgentBundle({ home: HOME, resourcesPath: res, force: true, provisionPyEnv: false })
const withEcc = readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8')
// The point is not that ECC is mentioned -- it is that the Council is told the
// only two calls that reach it, that weak matches need judging, and that using
// one does not get it out of updating the board.
ok('once ECC is on disk the Council is told how to reach it, and who still leads',
  withEcc.includes('ecc_find') && withEcc.includes('ecc_read') &&
  withEcc.includes('weak') && withEcc.includes('You stay the orchestrator') &&
  withEcc.includes('add_item'))
ok('the Council is never told ECC is loaded -- it is not, and that is the point',
  !withEcc.includes('ecc@ecc') && withEcc.includes('NOT loaded'))

// --- the agent -> board chain, end to end --------------------------------- //
// "The agents do not update the board any more" is a report about a chain: the
// server has to be on disk, runnable with the exact command each agent was
// handed, and named in each tool's own config. Every link works here, so a real
// break is machine-specific -- which is the whole reason this check exists.
// These assertions are what make its verdict trustworthy.
const okHealth = await trackerHealth(tracked, HOME)
ok('the tracker chain is healthy on a fresh deploy, checked link by link',
  okHealth.ok === true && okHealth.serverPresent === true && okHealth.problem === null)
ok('the health check LAUNCHES the registered command, it does not just stat it',
  okHealth.serverRuns === true && okHealth.toolCount >= 8)
ok('every agent that can carry the tracker is wired',
  ['claude-code', 'codex', 'gemini', 'qwen', 'cursor']
    .every((id) => okHealth.agents.find((a) => a.id === id)?.registered === true))

// Claude Code owns ~/.claude.json and rewrites it on its own schedule, so our
// entry can go missing through nobody's fault. That is the one failure the
// panel offers a repair for, so it has to be both detected and repairable.
const cjBefore = JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8'))
delete cjBefore.mcpServers.planide
writeFileSync(join(HOME, '.claude.json'), JSON.stringify(cjBefore))
const dropped = await trackerHealth(tracked, HOME)
ok('a dropped planide entry is detected and named, not silently tolerated',
  dropped.ok === false && typeof dropped.problem === 'string' && dropped.problem.includes('Claude Code'))
repairTrackerRegistration(HOME)
const repaired = await trackerHealth(tracked, HOME)
ok('Repair writes it back and the chain reports healthy again',
  repaired.ok === true && repaired.agents.find((a) => a.id === 'claude-code').registered === true &&
  JSON.parse(readFileSync(join(HOME, '.claude.json'), 'utf8')).mcpServers.other)

// --- the agent-description budget: one roster, never two ------------------- //
// PulsarIDE's bundle IS ThePunisher-Agent's roster. Someone running that
// project's own installer too has the same 100 team leads here already, under a
// `thepunisher-` prefix -- which does not collide with our `pulse-` one, so
// without a guard the two ADD and Claude Code goes over its ~15k description
// budget. That is what "subagents suddenly stopped working" actually is.
const descTokens = (dir, prefix) => {
  let t = 0
  for (const f of readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.md'))) {
    const head = readFileSync(join(dir, f), 'utf8').slice(0, 4000)
    const d = /^description:\s*([\s\S]*?)(?=^\w+:|^---)/m.exec(head)
    if (d) t += (d[1].replace(/\s+/g, ' ').trim().length + f.length) / 4
  }
  return t
}
const oneRoster = descTokens(join(HOME, '.claude/agents'), 'pulse-')
ok(`one roster fits Claude Code's ~15k description budget (~${Math.round(oneRoster)} tokens)`,
  oneRoster > 0 && oneRoster < 15000)
ok('two rosters would NOT fit -- which is why the guard below has to exist',
  oneRoster * 2 > 15000)

// Simulate the standalone installer having already deployed the same roster.
const HOME2 = join(work, 'home-dual'); mkdirSync(HOME2)
for (const d of ['.claude/agents', '.gemini/agents', '.codex/agents']) {
  mkdirSync(join(HOME2, d), { recursive: true })
}
writeFileSync(join(HOME2, '.claude/agents/thepunisher-council.md'), '---\nname: thepunisher-council\ndescription: x\n---\n')
writeFileSync(join(HOME2, '.gemini/agents/thepunisher-council.md'), '---\nname: thepunisher-council\ndescription: x\n---\n')
writeFileSync(join(HOME2, '.codex/agents/thepunisher-council.toml'), 'name = "thepunisher-council"\n')
// An agent the USER wrote that happens to share the prefix. It is not the
// generated roster, so it must survive.
writeFileSync(join(HOME2, '.claude/agents/thepunisher-mine.md'), '---\nname: my-own-agent\ndescription: hand written\n---\nmine\n')
deployAgentBundle({ home: HOME2, resourcesPath: res, force: true, provisionPyEnv: false })
const dupPulse = (d, ext) => readdirSync(join(HOME2, d)).filter((f) => f.startsWith('pulse-') && f.endsWith(ext)).length
// Ours is the roster this app ships, so ours is the one that must be there.
// Keeping theirs and skipping ours meant PulsarIDE never deployed its own agent
// and kept answering as "ThePunisher" -- reported exactly that way.
ok('our roster IS deployed even when the older one is present (Claude)', dupPulse('.claude/agents', '.md') > 50)
ok('our roster is deployed (Gemini)', dupPulse('.gemini/agents', '.md') > 50)
ok('our roster is deployed (Codex)', dupPulse('.codex/agents', '.toml') > 50)
ok('the superseded roster is removed, so only one copy is loaded',
  !existsSync(join(HOME2, '.claude/agents/thepunisher-council.md')) &&
  !existsSync(join(HOME2, '.gemini/agents/thepunisher-council.md')) &&
  !existsSync(join(HOME2, '.codex/agents/thepunisher-council.toml')))
ok('a hand-written agent sharing the prefix is NOT removed',
  existsSync(join(HOME2, '.claude/agents/thepunisher-mine.md')))
ok('and what remains still fits the description budget',
  descTokens(join(HOME2, '.claude/agents'), 'pulse-') < 15000)
ok('the tracker still reaches the main session in that case (managed block)',
  readFileSync(join(HOME2, '.claude/CLAUDE.md'), 'utf8').includes('get_board'))

// --- never destroy ~/.claude/settings.json ---------------------------------- //
// That file is not ours. Claude Code keeps env/permissions there, and Orca
// installs the managed agent hooks its ORCHESTRATOR tracks Claude/Codex
// subagents through. This used to reset it to {} whenever JSON.parse threw --
// a concurrent write while Orca installs its own hooks is enough -- which
// deleted Orca's hooks and broke subagents driven from the IDE.
const HOME3 = join(work, 'home-malformed'); mkdirSync(join(HOME3, '.claude'), { recursive: true })
const malformed = '{ "hooks": { "SubagentStop": [ {"orca": true} ]  <<< truncated'
writeFileSync(join(HOME3, '.claude/settings.json'), malformed)
deployAgentBundle({ home: HOME3, resourcesPath: res, force: true, provisionPyEnv: false })
ok('a settings.json we cannot parse is left byte-for-byte alone (Orca hooks survive)',
  readFileSync(join(HOME3, '.claude/settings.json'), 'utf8') === malformed)

// A settings.json we CAN parse keeps every key and every foreign hook.
const HOME4 = join(work, 'home-orca'); mkdirSync(join(HOME4, '.claude'), { recursive: true })
writeFileSync(join(HOME4, '.claude/settings.json'), JSON.stringify({
  env: { FOO: 'bar' },
  permissions: { allow: ['Bash'] },
  hooks: {
    SubagentStop: [{ hooks: [{ type: 'command', command: 'orca-agent-hook' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: 'someone-elses-hook' }] }]
  }
}, null, 2))
deployAgentBundle({ home: HOME4, resourcesPath: res, force: true, provisionPyEnv: false })
const st = JSON.parse(readFileSync(join(HOME4, '.claude/settings.json'), 'utf8'))
ok("Orca's SubagentStop hook is untouched (its orchestrator keeps working)",
  JSON.stringify(st.hooks.SubagentStop).includes('orca-agent-hook'))
ok('unrelated settings keys survive (env, permissions)',
  st.env.FOO === 'bar' && st.permissions.allow[0] === 'Bash')
ok("someone else's SessionStart hook survives alongside ours",
  st.hooks.SessionStart.some((e) => JSON.stringify(e).includes('someone-elses-hook')) &&
  st.hooks.SessionStart.some((e) => JSON.stringify(e).includes('graphify-bootstrap')))
ok('no temp file is left behind by the atomic write',
  readdirSync(join(HOME4, '.claude')).every((f) => !f.includes('.tmp')))

// --- a stale install must catch up ----------------------------------------- //
// This is the bug that made agents point at a specialists directory that was not
// on disk. bundle_version was last raised for v0.22.0, so every later change --
// including the 100 specialist files -- sat behind a version that never moved:
// an existing install returned "already at 2.0.0" and wrote nothing, forever.
// Freshness now comes from the bundle's own content, so a forgotten constant
// cannot strand anyone again.
const HOME5 = join(work, 'home-stale')
mkdirSync(join(HOME5, '.config/pulsaride'), { recursive: true })
writeFileSync(join(HOME5, '.config/pulsaride/agent-bundle.json'),
  JSON.stringify({ bundle_version: '2.0.0', agents: [], skills: [], hooks: [] }))
const stale = deployAgentBundle({ home: HOME5, resourcesPath: res, provisionPyEnv: false })
ok('an install marked with the current bundle_version but missing content redeploys',
  stale.deployed === true)
ok('and the specialists the team leads are told to read actually land',
  existsSync(join(HOME5, '.config/pulsaride/specialists')) &&
  readdirSync(join(HOME5, '.config/pulsaride/specialists')).length > 50)
const settled = deployAgentBundle({ home: HOME5, resourcesPath: res, provisionPyEnv: false })
ok('once it matches, a normal launch still costs nothing', settled.deployed === false)

// --- the agent's plan reaches the board ------------------------------------ //
// PostToolUse + an exact TodoWrite matcher is what lets the board show the steps
// an agent means to take, and show them being worked off.
const settingsAfter = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8'))
const postHooks = settingsAfter.hooks?.PostToolUse ?? []
const todoEntry = postHooks.find((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('todo-sync')))
ok('the plan hook is wired on TodoWrite specifically',
   Boolean(todoEntry) && todoEntry.matcher === 'TodoWrite')
ok('its launcher and script are both on disk',
   existsSync(join(HOME, '.config/pulsaride/hooks/todo-sync.mjs')) &&
   existsSync(todoEntry.hooks[0].command))
// Reconcile, not accumulate: a second deploy must not stack a second entry.
deployAgentBundle({ home: HOME, resourcesPath: res, force: true, provisionPyEnv: false })
const postAgain = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8')).hooks.PostToolUse
ok('a redeploy leaves exactly one plan hook',
   postAgain.filter((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('todo-sync'))).length === 1)

// --- the vendored libraries: pre-installed, and still there after an update -- //
// agency-agents (296 roles) and the ThreeUI design components are read off disk
// by whichever agent needs one, so "installed" has to mean really on disk -- and
// has to stay true after an update, which is what the signature is for.
ok('the agency-agents role library is deployed',
  existsSync(join(HOME, '.config/pulsaride/agency-agents')) &&
  existsSync(join(HOME, '.config/pulsaride/agency-agents/divisions.json')) &&
  readdirSync(join(HOME, '.config/pulsaride/agency-agents/engineering')).length > 20)
ok('the ThreeUI design components are deployed, with their index',
  existsSync(join(HOME, '.config/pulsaride/design/threeui/INDEX.md')) &&
  readdirSync(join(HOME, '.config/pulsaride/design/threeui')).length > 20)
ok('their licences travel with them',
  existsSync(join(HOME, '.config/pulsaride/agency-agents/LICENSE')) &&
  existsSync(join(HOME, '.config/pulsaride/design/threeui/LICENSE')))
// The budget rule these libraries exist under: they are read inline, never
// registered, because 296 more descriptions would break subagent dispatch.
ok('none of the 274 roles is registered as a Claude Code subagent',
  !readdirSync(join(HOME, '.claude/agents')).some((f) => /incident-response-commander/i.test(f)))

// An update that only changes a library must still reach an existing install.
// Built against a COPY of the bundle, so the real one is never touched.
const mutable = join(work, 'bundle-copy')
mkdirSync(mutable, { recursive: true })
cpSync(join(REPO, 'ide/agent-bundle'), join(mutable, 'pulsar-agents'), { recursive: true })
const HOMELIB = join(work, 'home-libupdate')
mkdirSync(HOMELIB, { recursive: true })
deployAgentBundle({ home: HOMELIB, resourcesPath: mutable, provisionPyEnv: false })
const settledLib = deployAgentBundle({ home: HOMELIB, resourcesPath: mutable, provisionPyEnv: false })
ok('an unchanged bundle still costs nothing', settledLib.deployed === false)
writeFileSync(join(mutable, 'pulsar-agents/agency-agents/engineering/brand-new-role.md'),
  '---\nname: Brand New Role\ndescription: added by an update\n---\nbody\n')
const libUpdate = deployAgentBundle({ home: HOMELIB, resourcesPath: mutable, provisionPyEnv: false })
ok('a library-only change is enough to trigger a redeploy', libUpdate.deployed === true)
ok('and the new role is on disk afterwards',
  existsSync(join(HOMELIB, '.config/pulsaride/agency-agents/engineering/brand-new-role.md')))
// ...and a role dropped upstream must not linger on the user's disk.
rmSync(join(mutable, 'pulsar-agents/agency-agents/engineering/brand-new-role.md'))
deployAgentBundle({ home: HOMELIB, resourcesPath: mutable, provisionPyEnv: false })
ok('a role removed upstream is reconciled away, not left behind',
  !existsSync(join(HOMELIB, '.config/pulsaride/agency-agents/engineering/brand-new-role.md')))

// --- the other installer's block must not keep speaking for us -------------- //
// ThePunisher-Agent's installer merges its own delimited block into these files,
// and that block tells the model to answer as "ThePunisher". It is always-loaded
// main-session context, so renaming the roster never silenced it.
const HOME6 = join(work, 'home-foreign')
mkdirSync(join(HOME6, '.claude'), { recursive: true })
writeFileSync(join(HOME6, '.claude/CLAUDE.md'),
  '# My own notes\n\nkeep me\n\n' +
  '<!-- >>> ThePunisher (auto-managed installer block; edits below are replaced on reinstall) >>> -->\n' +
  'Begin every reply with the ThePunisher banner.\n' +
  '<!-- <<< ThePunisher <<< -->\n')
deployAgentBundle({ home: HOME6, resourcesPath: res, force: true, provisionPyEnv: false })
const merged = readFileSync(join(HOME6, '.claude/CLAUDE.md'), 'utf8')
ok("the other installer's managed block is superseded, not left to answer as ThePunisher",
  !merged.includes('>>> ThePunisher') && !merged.includes('ThePunisher banner'))
ok('everything the user wrote themselves is kept verbatim',
  merged.includes('# My own notes') && merged.includes('keep me'))
ok('and our own block is what speaks now', merged.includes('PULSAR:MAIN:BEGIN'))

// --- opencode: a genuinely different config shape ---------------------------- //
// Verified against opencode's own docs source, not assumed to be Claude-shaped:
// servers live under `mcp`, a local one is typed, command and args are ONE array,
// and the environment key is `environment`.
const oc = JSON.parse(readFileSync(join(HOME, '.config/opencode/opencode.json'), 'utf8'))
ok('opencode gets the tracker under its own `mcp` key', Boolean(oc.mcp?.planide))
ok('as a typed local server with command and args in one array',
  oc.mcp.planide.type === 'local' && Array.isArray(oc.mcp.planide.command) &&
  oc.mcp.planide.command.length >= 2 && oc.mcp.planide.enabled === true)
ok('and env under `environment`, which is what opencode reads',
  oc.mcp.planide.environment === undefined || typeof oc.mcp.planide.environment === 'object')

// opencode falls back to ~/.claude/CLAUDE.md when it has no global AGENTS.md, and
// our block is already there. Creating one would switch that fallback off and
// silently drop whatever else the user keeps in the Claude file.
ok('no global AGENTS.md is invented for opencode -- its fallback already has us',
  !existsSync(join(HOME, '.config/opencode/AGENTS.md')))
const HOME7 = join(work, 'home-opencode')
mkdirSync(join(HOME7, '.config/opencode'), { recursive: true })
writeFileSync(join(HOME7, '.config/opencode/AGENTS.md'), '# mine\n\nkeep this\n')
deployAgentBundle({ home: HOME7, resourcesPath: res, force: true, provisionPyEnv: false })
const ocRules = readFileSync(join(HOME7, '.config/opencode/AGENTS.md'), 'utf8')
ok('but a global AGENTS.md the user already keeps does get the block, additively',
  ocRules.includes('PULSAR:MAIN:BEGIN') && ocRules.includes('keep this'))

// An unparseable config is opencode's own state, never ours to rewrite.
const HOME8 = join(work, 'home-opencode-jsonc')
mkdirSync(join(HOME8, '.config/opencode'), { recursive: true })
const jsonc = '{\n  // opencode config may legally carry comments\n  "theme": "mine"\n}\n'
writeFileSync(join(HOME8, '.config/opencode/opencode.json'), jsonc)
deployAgentBundle({ home: HOME8, resourcesPath: res, force: true, provisionPyEnv: false })
ok('a config with comments is left exactly as it was, not clobbered',
  readFileSync(join(HOME8, '.config/opencode/opencode.json'), 'utf8') === jsonc)

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
