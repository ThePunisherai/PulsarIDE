/**
 * Agent-bundle deploy test: the real module, run against a temp HOME.
 *
 * Bundled with esbuild and executed by ide/verify.sh -- no Electron needed,
 * because the deploy is plain Node fs. PULSAR_REPO points at the repo root so it
 * can find ide/agent-bundle.
 */
import { execSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs'
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
  setEccEnabled,
  meshyStatus,
  setMeshyKey,
  installEccNow,
  setUnrealPath,
  removeHeadroom,
  runHookDoctor,
  runHookTest,
  turnOffCodexHook,
  hookCommand,
  stripHeadroomLines,
  stripHeadroomToml
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
// Codex hooks the user configured themselves: ours must join, never replace.
writeFileSync(join(HOME, '.codex/hooks.json'), JSON.stringify({
  hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/bin/mine.sh' }] }] }
}))
// Pre-existing Gemini/Antigravity settings.json: registering planide must keep it.
mkdirSync(join(HOME, '.gemini'), { recursive: true })
writeFileSync(join(HOME, '.gemini/settings.json'), JSON.stringify({ theme: 'Default', mcpServers: { other: { command: 'x' } } }))
// An Antigravity install from before the ~/.gemini/config move, so the legacy
// path is a real branch under test and not just a line of code nobody runs.
mkdirSync(join(HOME, '.gemini/antigravity-cli'), { recursive: true })
// Same for Qwen Code, which keeps its own ~/.qwen/settings.json.
mkdirSync(join(HOME, '.qwen'), { recursive: true })
// ...with the Gemini-named hook groups 0.99.1 wrote there (inert in Qwen), and
// one of the user's own under such a name, which must survive their removal.
writeFileSync(join(HOME, '.qwen/settings.json'), JSON.stringify({
  vimMode: true,
  mcpServers: { other: { command: 'x' } },
  hooks: {
    AfterTool: [
      { matcher: 'write_todos', hooks: [{ type: 'command', command: '/old/.config/pulsaride/hooks/todo-sync.sh', timeout: 15000 }] },
      { matcher: 'read_file', hooks: [{ type: 'command', command: '/usr/bin/qwen-mine.sh' }] }
    ],
    BeforeAgent: [{ hooks: [{ type: 'command', command: '/old/.config/pulsaride/hooks/keep-going.sh', timeout: 15000 }] }],
    AfterAgent: [{ hooks: [{ type: 'command', command: '/old/.config/pulsaride/hooks/keep-going.sh', timeout: 15000 }] }],
    BeforeTool: [{ matcher: 'write_file', hooks: [{ type: 'command', command: '/old/.config/pulsaride/hooks/docs-guard.sh', timeout: 15000 }] }]
  }
}))
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
// Every host builds a skills CATALOG from name+description at startup and caps
// it: Codex allows 2% of model context, falling back to 8000 characters when the
// context size is unknown, and Claude Code allows roughly 15000. Over the cap the
// host silently shortens descriptions -- which eats the "Use when..." trigger
// words first, so the skill stops being picked for the request it exists for.
// That is a real reported symptom, not a theory: "Skill descriptions were
// shortened to fit the skills context budget". The full instructions live in each
// SKILL.md body, read only AFTER selection, so a catalog entry stays short on
// purpose. Guarded here because a re-vendor restores upstream's long descriptions
// and would put us back over the cap with no other warning.
const CATALOG_BUDGET = 8000
const catalogChars = readdirSync(join(REPO, 'ide/agent-bundle/skills'))
  .map((d) => {
    const f = join(REPO, 'ide/agent-bundle/skills', d, 'SKILL.md')
    if (!existsSync(f)) return ''
    const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(readFileSync(f, 'utf8'))
    if (!m) return ''
    const dm = /^description:[ \t]*([\s\S]*?)(?=^[\w-]+:|$(?![\s\S]))/m.exec(m[1])
    return dm ? dm[1].trim().replace(/^["']|["']$/g, '') : ''
  })
  .reduce((n, d) => n + d.length, 0)
ok(`skill catalog fits the hosts' budget (${catalogChars} <= ${CATALOG_BUDGET} chars)`,
  catalogChars > 0 && catalogChars <= CATALOG_BUDGET)
// A skill with no description, or one that just repeats its own name, can never
// be matched -- sharp-edges shipped exactly that way, its real description
// stranded in a second frontmatter block no YAML parser reads.
const uselessDesc = readdirSync(join(REPO, 'ide/agent-bundle/skills')).filter((d) => {
  const f = join(REPO, 'ide/agent-bundle/skills', d, 'SKILL.md')
  if (!existsSync(f)) return false
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(readFileSync(f, 'utf8'))
  if (!m) return true
  const dm = /^description:[ \t]*([\s\S]*?)(?=^[\w-]+:|$(?![\s\S]))/m.exec(m[1])
  const v = dm ? dm[1].trim().replace(/^["']|["']$/g, '') : ''
  return v.length < 20 || v.toLowerCase() === d.toLowerCase()
})
ok('every bundled skill has a real, matchable description', uselessDesc.length === 0)
// A redeploy must not delete a skill that is already correct. The old loop rm'd
// then cp'd every skill on every deploy, so each one was absent for the length of
// its own copy -- and an agent reading the directory in that window gets the name
// but cannot open it (Codex: "failed to read file ... os error 3", which is
// ERROR_PATH_NOT_FOUND -- the directory, not the file, on three alphabetically
// consecutive skills). Inode identity is the proof: same inode means the
// directory was never recreated, so the window never opened.
ok('redeploy leaves unchanged skills completely untouched (no delete/copy window)', (() => {
  const probe = ['autoship', 'aws-skills', 'ax-audit', 'ui-design']
  const before = probe.map((n) => statSync(join(HOME, '.codex/skills', n)).ino)
  deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false, force: true })
  const after = probe.map((n) => statSync(join(HOME, '.codex/skills', n)).ino)
  return probe.every((n, i) => before[i] === after[i]) &&
    probe.every((n) => existsSync(join(HOME, '.codex/skills', n, 'SKILL.md')))
})())
// ...but a skill whose content really did change still gets replaced, and no
// staging directory is left behind.
ok('a changed skill is still redeployed, with no .tmp left behind', (() => {
  const f = join(HOME, '.codex/skills/aws-skills/SKILL.md')
  writeFileSync(f, 'tampered\n')
  deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false, force: true })
  const restored = readFileSync(f, 'utf8') !== 'tampered\n' && readFileSync(f, 'utf8').includes('description:')
  const leftovers = readdirSync(join(HOME, '.codex/skills')).filter((d) => d.includes('.pulsar-'))
  return restored && leftovers.length === 0
})())
// The reconcile now skips still-shipping skills, so prove the half it still owns:
// a skill we STOPPED shipping must still be removed from every root, or an update
// leaves it behind for one tool and not the others.
ok('a skill we no longer ship is still removed from every root', (() => {
  const roots = ['.claude/skills', '.codex/skills', '.qwen/skills', '.gemini/config/skills']
  const gone = 'pulsar-retired-skill'
  for (const r of roots) {
    mkdirSync(join(HOME, r, gone), { recursive: true })
    writeFileSync(join(HOME, r, gone, 'SKILL.md'), '---\nname: gone\ndescription: "x"\n---\n')
  }
  // record it as ours from a previous deploy, the way a real marker would
  const mk = join(HOME, '.config/pulsaride/agent-bundle.json')
  const marker = JSON.parse(readFileSync(mk, 'utf8'))
  marker.skills = [...marker.skills, gone]
  writeFileSync(mk, JSON.stringify(marker))
  deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false, force: true })
  return roots.every((r) => !existsSync(join(HOME, r, gone)))
})())
// Qwen Code: same `<dir>/<name>.md` subagent shape as Gemini CLI, under ~/.qwen.
// Paths taken from the published @qwen-code/qwen-code bundle itself
// (QWEN_DIR='.qwen', AGENT_CONFIG_DIR='agents', SKILLS_CONFIG_DIR='skills',
// context filenames ['QWEN.md','AGENTS.md']), not inferred from the fork.
ok('Qwen Code gets the same roster and every bundled skill',
  readdirSync(join(HOME, '.qwen/agents')).filter(f => f.startsWith('pulse-') && f.endsWith('.md')).length === 100 &&
  existsSync(join(HOME, '.qwen/skills/agent-orchestrator/SKILL.md')) &&
  readdirSync(join(HOME, '.qwen/skills')).length === readdirSync(join(HOME, '.claude/skills')).length)
// Antigravity reads global skills from ~/.gemini/config/skills -- the same root
// deployAntigravitySkill already writes pulse-agent into. They were never copied
// there, so Council had nothing to name in Antigravity and the instructions
// pointed at ~/.claude/skills, which Antigravity does not read. Reported as
// "council in antigravity geeft geen opdracht welke skill agent gebruikt moet
// worden". The pulse-agent persona skill must survive alongside them.
ok('Antigravity gets every bundled skill in its own root, pulse-agent intact',
  existsSync(join(HOME, '.gemini/config/skills/agent-orchestrator/SKILL.md')) &&
  existsSync(join(HOME, '.gemini/config/skills/ui-design/SKILL.md')) &&
  existsSync(join(HOME, '.gemini/config/skills/pulse-agent/SKILL.md')) &&
  readdirSync(join(HOME, '.gemini/config/skills'))
    .filter((d) => existsSync(join(HOME, '.gemini/config/skills', d, 'SKILL.md')))
    .length === readdirSync(join(HOME, '.claude/skills')).length + 1)
// Codex reads $CODEX_HOME/skills (default ~/.codex/skills) and SKILL.md is the
// portable cross-agent format, so the same folders serve it unchanged. Before
// this it got NONE of them -- the design skills in particular -- and only ever
// reached one by reading Claude Code's absolute path, which works by accident on
// a machine that also has Claude Code and not at all otherwise.
ok('Codex gets every bundled skill in its own root',
  existsSync(join(HOME, '.codex/skills/ui-design/SKILL.md')) &&
  existsSync(join(HOME, '.codex/skills/product-design/SKILL.md')) &&
  existsSync(join(HOME, '.codex/skills/ui-verification/SKILL.md')) &&
  existsSync(join(HOME, '.codex/skills/typography-audit/SKILL.md')) &&
  readdirSync(join(HOME, '.codex/skills'))
    .filter((d) => existsSync(join(HOME, '.codex/skills', d, 'SKILL.md')))
    .length === readdirSync(join(HOME, '.claude/skills')).length)
// Every tool is told where ITS OWN skills live, not just Claude Code's.
ok('the skills instruction names Codex\'s own skills root',
  readFileSync(join(HOME, '.codex/AGENTS.md'), 'utf8').includes(join(HOME, '.codex', 'skills')))
// Codex records hook trust against the hook entry's content hash and re-prompts
// "hooks need review" for anything it sees as changed, so an unchanged config
// must not be rewritten: the atomic rename swaps the inode even byte-identical.
ok('an unchanged config is not rewritten (Codex hook trust stays valid)', (() => {
  const hooks = join(HOME, '.codex/hooks.json')
  const before = statSync(hooks)
  const txt = readFileSync(hooks, 'utf8')
  deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false })
  const after = statSync(hooks)
  return readFileSync(hooks, 'utf8') === txt && after.ino === before.ino && after.mtimeMs === before.mtimeMs
})())
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

// Antigravity CLI had the MCP tools and the merged GEMINI.md block, but no entry
// in `/agents` and nothing the primary agent could route to -- "in antigravity
// cli zie ik geen pulse agent of council". Its custom agents are a DIRECTORY per
// agent holding an `agent.md`, under its own global root, not `~/.gemini/agents`
// (that is Gemini CLI's; the shared ~/.gemini is what hid this).
const agRoot = join(HOME, '.gemini/config/agents')
const agDirs = existsSync(agRoot) ? readdirSync(agRoot).filter((d) => d.startsWith('pulse-')) : []
ok('Antigravity gets the whole roster as real custom agents',
  agDirs.length === 100 && agDirs.every((d) => existsSync(join(agRoot, d, 'agent.md'))))
ok('Antigravity gets the Council specifically',
  existsSync(join(agRoot, 'pulse-council', 'agent.md')))

// The deploy short-circuits when the bundle fingerprint is unchanged, and that
// fingerprint includes DEPLOY_TARGETS precisely so "same bundle, NEW place to
// write it" still redeploys. Adding Qwen Code needed that. Adding Antigravity
// needed it too and did not get it: v0.81.0 shipped the agents and every
// existing install answered "already at 2.0.0" and wrote nothing -- reported as
// the Council still being invisible after the release that added it.
//
// Derived from what the deploy actually wrote rather than a hand-kept list, so
// the NEXT tool is covered by having been added, not by someone remembering.
{
  const srcPath = join(process.env.PULSAR_REPO, 'ide/overlay/src/main/planide/agent-bundle.ts')
  const targets = readFileSync(srcPath, 'utf8').match(/const DEPLOY_TARGETS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  // Every directory under HOME holding agents this deploy wrote.
  const roots = new Set()
  const walk = (abs, rel, depth) => {
    if (depth > 4) return
    let entries
    try { entries = readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) {
        if (/^pulse-.+\.(md|toml)$/.test(e.name)) roots.add(rel)
        continue
      }
      // Antigravity's shape: <root>/pulse-<name>/agent.md
      if (/^pulse-/.test(e.name) && existsSync(join(abs, e.name, 'agent.md'))) roots.add(rel)
      else walk(join(abs, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1)
    }
  }
  for (const top of ['.claude', '.codex', '.gemini', '.qwen']) {
    walk(join(HOME, top), top, 0)
  }
  const unlisted = [...roots].filter((r) => !targets.includes(`'${r}'`))
  ok(`every directory the deploy writes agents to is in DEPLOY_TARGETS (${roots.size} found)`,
    roots.size >= 5 && unlisted.length === 0)
  if (unlisted.length) console.log('       not in DEPLOY_TARGETS: ' + unlisted.join(', '))
}
// Both of Antigravity's global rules files, not one: the report was that Council
// does not lead a session there even with the GEMINI.md block on disk, which is
// what a build that reads AGENTS.md globally would look like.
for (const f of ['.gemini/GEMINI.md', '.gemini/AGENTS.md']) {
  const text = existsSync(join(HOME, f)) ? readFileSync(join(HOME, f), 'utf8') : ''
  ok(`${f} carries the Council block, so the main session is led`,
    text.includes('PULSAR:MAIN:BEGIN') && text.includes('Pulse Agent — Council') &&
    text.includes('get_board'))
}
{
  // Every one has to be loadable: real YAML frontmatter, marked as a subagent so
  // the primary agent can invoke it, and a directory name matching its own name
  // (Antigravity resolves an agent by its directory).
  let bad = 0
  let truncated = 0
  for (const d of agDirs) {
    const text = readFileSync(join(agRoot, d, 'agent.md'), 'utf8')
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!m) { bad++; continue }
    const front = m[1]
    const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim()
    const desc = front.match(/^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1]
    if (name !== d) bad++
    else if (!/^subagent:\s*true$/m.test(front)) bad++
    else if (!desc || !desc.trim()) bad++
    else if (!m[2].includes('# System Prompt')) bad++
    // The description drives routing here, so a folded block cut at its first
    // line ("...as the first and last") is a real defect, not a cosmetic one.
    if (desc && /\b(and last|the first and)$/.test(desc.trim())) truncated++
  }
  ok('every Antigravity agent.md is well-formed and invocable', bad === 0)
  ok('descriptions are the whole folded block, not the first line', truncated === 0)
  const council = readFileSync(join(agRoot, 'pulse-council', 'agent.md'), 'utf8')
  ok('and the persona itself survives the conversion',
    council.includes('The Council') && council.includes('get_board') &&
    council.includes('Pulse Agent —'))
}
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

// ECC was on disk and named in the always-loaded CLAUDE.md/AGENTS.md block, but
// NOT in the Council persona itself -- and a subagent runs on its own persona
// file, not the user-level block. So Council, the one deciding what to reach
// for, never learned ECC existed: "council doet niets met ECC", exactly as
// reported. It has to be in the persona, in every format Council ships in.
for (const [label, file] of [
  ['Claude Code', '.claude/agents/pulse-council.md'],
  ['Codex', '.codex/agents/pulse-council.toml'],
  ['Gemini CLI', '.gemini/agents/pulse-council.md']
]) {
  const text = existsSync(join(HOME, file)) ? readFileSync(join(HOME, file), 'utf8') : ''
  ok(`${label}: Council's own persona tells it ECC exists and how to call it`,
    text.includes('ecc_find') && text.includes('ecc_read'))
  // Token saving is only real if the persona knows the two tools exist. caveman
  // is installed; rtk is detected, never installed by us.
  ok(`${label}: and how to spend fewer tokens (caveman, and rtk when present)`,
    text.includes('caveman') && text.includes('rtk'))
  // Same class of gap as the ECC one above, found the same way: Council is the
  // orchestrator of a project tracker and its persona mentioned the board once,
  // in passing. It was never told to read it, keep it true, or deal with the fix
  // log -- which is why fixes sat open and nothing walked them.
  ok(`${label}: Council is told to read the board before routing`,
    text.includes('get_board') && text.includes('sync_plan'))
  ok(`${label}: and to close open fixes with a real solution, or reopen/park them`,
    text.includes('mark_fixed') && text.includes('reopen_fix') &&
    text.includes('wontfix'))
  // The user's own rule: finish what is in progress, then todo; a bug found on
  // the way goes to Fixes > Open and is picked up later, not chased mid-task.
  ok(`${label}: Council works the board in its fixed order and parks new bugs in Fixes > Open`,
    text.includes('next_task') && text.includes('Fixes > Open') &&
    /finish what is in progress/.test(text))
}

// The caveman skill is MIT and pure prose -- no binary, no endpoint, no key. It
// has to actually land on disk, or the persona is pointing at nothing.
const cavemanSkill = join(HOME, '.claude/skills/caveman/SKILL.md')
ok('the caveman skill is deployed with the rest',
  existsSync(cavemanSkill))
ok('and it is the standalone prose one, carrying no proxy or credential',
  (() => {
    const t = existsSync(cavemanSkill) ? readFileSync(cavemanSkill, 'utf8') : ''
    return t.length > 0 && !/ANTHROPIC_BASE_URL|API_KEY|localhost:|npm install/i.test(t)
  })())
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
ok('Gemini CLI MCP registered at ~/.gemini/settings.json, user content preserved',
  gem1.mcpServers.planide.args[0] === trackerScript && gem1.mcpServers.other && gem1.theme === 'Default')
// Antigravity shares ~/.gemini with Gemini CLI but not its settings file: the
// IDE, the agy CLI and the SDK read ~/.gemini/config/mcp_config.json. Writing
// only settings.json looked like it covered both and covered one, so every
// planide/pulsar-tools tool was absent in Antigravity -- not failing, absent.
const agCfg = JSON.parse(readFileSync(join(HOME, '.gemini/config/mcp_config.json'), 'utf8'))
ok('Antigravity MCP registered at ~/.gemini/config/mcp_config.json, not settings.json',
  agCfg.mcpServers.planide.args[0] === trackerScript)
ok('Antigravity gets the whole toolkit, not just the tracker',
  Boolean(agCfg.mcpServers['pulsar-tools']))
ok('a pre-migration Antigravity is written too (~/.gemini/antigravity-cli)',
  JSON.parse(readFileSync(join(HOME, '.gemini/antigravity-cli/mcp_config.json'), 'utf8'))
    .mcpServers.planide.args[0] === trackerScript)
// The legacy file is a fallback, not a directory to create on a machine that
// never had it -- same rule the Cursor rule follows for ~/.cursor.
const freshHome = join(work, 'home-no-legacy'); mkdirSync(freshHome, { recursive: true })
repairTrackerRegistration(freshHome)
ok('no pre-migration directory is invented where Antigravity never used one',
  existsSync(join(freshHome, '.gemini/config/mcp_config.json')) &&
  !existsSync(join(freshHome, '.gemini/antigravity-cli')))

// One launch, every agent. They fail separately otherwise, and a tracker that
// works in one CLI and dies in another is the hardest kind of report to act on.
ok('every agent gets the same dependency-free launch (claude/codex/cursor/gemini/antigravity)',
  [JSON.parse(readFileSync(join(HOME, '.cursor/mcp.json'), 'utf8')).mcpServers.planide,
   gem1.mcpServers.planide, agCfg.mcpServers.planide]
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

// One full block per tool, never two. Codex, Qwen and Cursor read their own file
// AND the project AGENTS.md; Antigravity reads GEMINI.md AND ~/.gemini/AGENTS.md.
// Both AGENTS.md files carrying the full ~18k-character block was up to ~10k
// tokens of duplicates on every turn. They carry the compact block now.
{
  const ours = (text) => {
    const m = text.split('<!-- PULSAR:MAIN:BEGIN -->')[1] ?? ''
    return m.split('<!-- PULSAR:MAIN:END -->')[0]
  }
  const full = ours(readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8')).length
  const projectBlock = ours(agentsMd).length
  const geminiAgents = ours(readFileSync(join(HOME, '.gemini/AGENTS.md'), 'utf8')).length
  ok(`the project AGENTS.md carries the compact block, not a second full one (${projectBlock} vs ${full} chars)`,
    projectBlock > 0 && projectBlock < 3000 && full > 10000)
  ok('so does ~/.gemini/AGENTS.md, which Antigravity reads beside GEMINI.md',
    geminiAgents > 0 && geminiAgents < 3000 &&
    ours(readFileSync(join(HOME, '.gemini/GEMINI.md'), 'utf8')).length > 10000)
  ok('and the compact block still points the work at the board and its order',
    agentsMd.includes('next_task') && agentsMd.includes('add_fix') && agentsMd.includes('pulse-agent'))
}

// --- Codex gets every server we own, not just the tracker ------------------ //
// It only ever got `planide`, so an agent there had the board and none of
// pulsar-tools: no route_task, no ui_find, no ecc_find, no anti-loop check.
ok('Codex is registered for pulsar-tools too, not only planide', (() => {
  const toml = readFileSync(join(HOME, '.codex/config.toml'), 'utf8')
  return toml.includes('[mcp_servers.planide]') && toml.includes('[mcp_servers.pulsar-tools]') &&
    toml.includes('[mcp_servers.other]') && toml.includes('model = "gpt-5"')
})())

// --- Meshy: a paid API, so the key is the whole gate ----------------------- //
// Registered only once a key exists: with none, its server exits on the missing
// MESHY_API_KEY and every agent shows a broken tool. So the thing to prove is
// that it appears and disappears with the key, in every agent's own config.
const cfgFor = (f) => JSON.parse(readFileSync(join(HOME, f), 'utf8')).mcpServers ?? {}
ok('no key means no meshy server anywhere',
  meshyStatus(HOME).configured === false && !cfgFor('.claude.json').meshy &&
  !cfgFor('.gemini/settings.json').meshy && !cfgFor('.cursor/mcp.json').meshy)

const saved = setMeshyKey('msy_abcdef0123456789', HOME)
ok('saving a key registers meshy for every agent, key in env and never in args',
  saved.configured === true &&
  ['.claude.json', '.gemini/settings.json', '.qwen/settings.json', '.cursor/mcp.json',
   '.gemini/config/mcp_config.json'].every((f) => {
    const m = cfgFor(f).meshy
    return m && m.env?.MESHY_API_KEY === 'msy_abcdef0123456789' &&
      !JSON.stringify(m.args).includes('msy_')
  }) && readFileSync(join(HOME, '.codex/config.toml'), 'utf8').includes('[mcp_servers.meshy]'))
ok('the status hint identifies the key without exposing it',
  saved.hint.startsWith('msy_abcd') && saved.hint.endsWith('6789') &&
  !saved.hint.includes('msy_abcdef0123456789'))
ok('clearing the key removes the server again, it is not left stale',
  setMeshyKey('', HOME).configured === false && !cfgFor('.claude.json').meshy &&
  !cfgFor('.gemini/settings.json').meshy && !cfgFor('.gemini/config/mcp_config.json').meshy)

// --- Unreal: a LOCAL server, so the folder is the whole gate --------------- //
// It drives a running Unreal editor through the UnrealMCP plugin, so it only
// means anything on a machine with Unreal. The invocation is upstream's own
// (uv --directory <repo>/Python run unreal_mcp_server_advanced.py); what has to
// hold here is that it appears in all six agent configs when the folder really
// contains that script, and in none of them when it does not.
const unrealRepo = join(work, 'unreal-engine-mcp')
mkdirSync(join(unrealRepo, 'Python'), { recursive: true })
writeFileSync(join(unrealRepo, 'Python', 'unreal_mcp_server_advanced.py'), '# stub')

ok('a folder without the server script registers nothing, and says why', (() => {
  const bad = setUnrealPath(join(work, 'not-unreal-at-all'), HOME)
  return bad.configured === true && bad.ready === false && bad.problem !== '' &&
    !cfgFor('.claude.json').unreal
})())

const ue = setUnrealPath(unrealRepo, HOME)
ok('pointing at the clone registers unreal for every agent, via uv and the real script',
  ue.ready === true &&
  ['.claude.json', '.gemini/settings.json', '.qwen/settings.json', '.cursor/mcp.json',
   '.gemini/config/mcp_config.json'].every((f) => {
    const u = cfgFor(f).unreal
    return u && u.command === 'uv' &&
      JSON.stringify(u.args).includes('unreal_mcp_server_advanced.py')
  }) && readFileSync(join(HOME, '.codex/config.toml'), 'utf8').includes('[mcp_servers.unreal]'))

ok('clearing the folder unregisters it everywhere, including the Codex TOML',
  setUnrealPath('', HOME).configured === false && !cfgFor('.claude.json').unreal &&
  !cfgFor('.gemini/settings.json').unreal &&
  !cfgFor('.gemini/config/mcp_config.json').unreal &&
  !readFileSync(join(HOME, '.codex/config.toml'), 'utf8').includes('[mcp_servers.unreal]'))

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
// ECC ships IN the bundle now. It used to be fetched on first launch (claude
// CLI, else git clone), which on a machine with neither on PATH is a permanent
// "not fetched yet" -- exactly what a real user was looking at. Deployed from
// disk there is nothing to fail, so this asserts the real copy, not a marker.
const HOME_ECC = join(work, 'home-ecc')
mkdirSync(HOME_ECC)
const eccBundle = join(res, 'pulsar-agents')
const eccOut = installEccNow(HOME_ECC, eccBundle)
const eccDir = join(HOME_ECC, '.claude', 'plugins', 'marketplaces', 'ecc')
ok('ECC is deployed straight from the bundle -- no git, no network, no npx',
  eccOut.installed === true &&
  readdirSync(join(eccDir, 'skills')).length > 250 &&
  existsSync(join(eccDir, 'skills', 'security-review', 'SKILL.md')) &&
  readdirSync(join(eccDir, 'agents')).filter((f) => f.endsWith('.md')).length === 68)

// An ECC the user installed themselves is a fuller copy than ours; replacing it
// would be a downgrade they never asked for.
const HOME_ECC2 = join(work, 'home-ecc2')
mkdirSync(join(HOME_ECC2, '.claude', 'plugins', 'marketplaces', 'ecc'), { recursive: true })
writeFileSync(join(HOME_ECC2, '.claude/plugins/marketplaces/ecc/THEIRS'), 'x')
installEccNow(HOME_ECC2, eccBundle)
ok('an ECC the user installed themselves is left alone',
  existsSync(join(HOME_ECC2, '.claude/plugins/marketplaces/ecc/THEIRS')))

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
  ['claude-code', 'codex', 'gemini', 'qwen', 'cursor', 'antigravity']
    .every((id) => okHealth.agents.find((a) => a.id === id)?.registered === true))
// Antigravity used to be a slash on Gemini's row, so a green banner said nothing
// about it either way. It reports on its own file now, or it reports nothing.
// The Toolkit page badges an agent with the name of its plan hook, keyed on the
// agent id. If an id here and an id there ever drift, the page quietly claims an
// agent needs sync_plan when it actually has a hook -- wrong in the direction of
// under-promising, but still wrong, and invisible. Read from the page's source
// so it cannot pass by being copied.
const toolkitSrc = readFileSync(
  join(REPO, 'ide/overlay/src/renderer/src/components/planide/PulseToolkitPage.tsx'),
  'utf8'
)
const hookIds = [...toolkitSrc.matchAll(/^\s*'?([a-z-]+)'?:\s*'(TodoWrite|update_plan|write_todos|todo_write)'/gm)].map(
  (m) => m[1]
)
ok('every agent the Toolkit page badges with a plan hook is a real agent id',
  hookIds.length === 4 && hookIds.every((id) => okHealth.agents.some((a) => a.id === id)))

ok('the panel reports Antigravity separately, against its own config file',
  okHealth.agents.find((a) => a.id === 'antigravity')?.configPath.endsWith('mcp_config.json') === true &&
  okHealth.agents.find((a) => a.id === 'gemini')?.label === 'Gemini CLI')

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

// One agent unwired while the others work is the failure that hid for months:
// the panel stayed green off the agents that DID update the board, so "it works
// in Claude and never in Antigravity" had nothing to show for it. It has to be
// named, and it has to name the right one.
const agPath = join(HOME, '.gemini/config/mcp_config.json')
const agSaved = JSON.parse(readFileSync(agPath, 'utf8'))
const agMinus = JSON.parse(JSON.stringify(agSaved))
delete agMinus.mcpServers.planide
writeFileSync(agPath, JSON.stringify(agMinus))
const oneDown = await trackerHealth(tracked, HOME)
ok('one installed-but-unwired agent is named, not hidden behind the ones that work',
  oneDown.ok === false && oneDown.problem?.includes('Antigravity') === true)
repairTrackerRegistration(HOME)
ok('Repair wires that agent back too',
  (await trackerHealth(tracked, HOME)).ok === true)

// A config we cannot parse is one we refuse to rewrite -- there is a test above
// pinning that we never clobber a JSONC file. But refusing SILENTLY is what made
// "Wire the missing ones" look dead: the row stayed red, the button appeared to
// do nothing, and nothing anywhere said the file was the reason. So the refusal
// has to be visible and it has to name the agent.
const cursorCfg = join(HOME, '.cursor/mcp.json')
const cursorSaved = readFileSync(cursorCfg, 'utf8')
writeFileSync(cursorCfg, '{\n  // Cursor lets you write comments here\n  "mcpServers": {}\n}\n')
const unreadable = await trackerHealth(tracked, HOME)
const cursorRow = unreadable.agents.find((a) => a.id === 'cursor')
ok('an unparseable config is reported as unreadable, not merely unregistered',
  cursorRow?.configExists === true && cursorRow?.readable === false)
ok('and the problem names which agent is stuck, so Repair is not blamed',
  unreadable.problem?.includes('Cursor') === true)
repairTrackerRegistration(HOME)
ok('Repair still refuses to rewrite it -- the comments survive',
  readFileSync(cursorCfg, 'utf8').includes('// Cursor lets you write comments here'))
writeFileSync(cursorCfg, cursorSaved)

// --- team leads: how they work once Council dispatches them ---------------- //
// "De agents in teams werken niet goed." Measured across the 100 leads: 82 were
// told to hand off to another team (a Claude Code subagent cannot start one, so
// that went nowhere), none knew where their own specialists were, none had a
// return format, and all 100 pointed at a CLAUDE.md note that did not exist.
{
  const dir = join(HOME, '.claude/agents')
  const leads = readdirSync(dir).filter((f) => f.startsWith('pulse-') && f.endsWith('.md'))
  const contract = (f) => readFileSync(join(dir, f), 'utf8')
  const withContract = leads.filter((f) => contract(f).includes('## Working as a Pulse team lead'))
  ok(`every team lead but Council carries the team-lead contract (${withContract.length}/${leads.length - 1})`,
    withContract.length === leads.length - 1 && !withContract.includes('pulse-council.md'))
  const pathOk = withContract.every((f) => {
    const m = /are in `([^`]+)`/.exec(contract(f))
    return m && existsSync(m[1]) && m[1].endsWith(f.replace(/^pulse-/, ''))
  })
  ok('and each one names its OWN specialists file, which really exists', pathOk)
  ok('a lead hands off by returning a Handoff line, because it cannot start another agent',
    withContract.every((f) => contract(f).includes('Handoff: pulse-<team>') && contract(f).includes('cannot start other agents')))
  ok('and returns what changed, what was verified and what is left',
    withContract.every((f) => contract(f).includes('what you verified')))
  ok('no lead points at a CLAUDE.md note that does not exist any more',
    leads.every((f) => !contract(f).includes('"Knowledge graph memory" note')))
  // Codex gets the same body as developer_instructions.
  ok('Codex team leads carry the same contract',
    readFileSync(join(HOME, '.codex/agents/pulse-backend-api.toml'), 'utf8').includes('## Working as a Pulse team lead'))
  // The other end of the handoff: the one who CAN dispatch is told to.
  const council = contract('pulse-council.md')
  const main = readFileSync(join(HOME, '.claude/CLAUDE.md'), 'utf8')
  ok('Council dispatches Handoff lines and does not do a named team\'s work itself',
    council.includes('## Dispatching teams') && council.includes('Handoff: pulse-<team>'))
  ok('the main session routes through route_task and dispatches handoffs too',
    /Route, on demand\.\*\* Call `route_task/.test(main) && main.includes('Handoff: pulse-<team>'))
}

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
// The roster's descriptions were cut to their scope line in 0.97.0 (the full
// text moved into each agent's body, read only when it runs). So one roster now
// takes under half the budget -- which leaves the user's own agents room. A
// second copy would still double the bill, so the guard below stays.
ok('one roster uses under half of the description budget, leaving room for the user\'s own agents',
  oneRoster < 7500)

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
// Codex has a real plan hook of its own -- PostToolUse matched on `update_plan`,
// its actual plan tool. Without it Codex only reaches the board when the model
// remembers to call sync_plan, while Claude Code never had to remember. That
// asymmetry is most of what "the tracker does not update" meant on Codex.
const codexHooks = JSON.parse(readFileSync(join(HOME, '.codex/hooks.json'), 'utf8'))
const codexPost = codexHooks.hooks?.PostToolUse ?? []
const codexPlan = codexPost.find((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('todo-sync')))
ok('Codex gets the same plan sync, matched on its own update_plan tool',
  Boolean(codexPlan) && codexPlan.matcher === 'update_plan')
ok('and it names the launcher that is really on disk',
  existsSync(codexPlan.hooks[0].command))
// timeoutSec, not timeout: Codex's own ConfiguredHookHandler names it that, and
// deny_unknown_fields means the wrong spelling is a rejected config, not a default.
ok('with the timeout field Codex actually accepts',
  typeof codexPlan.hooks[0].timeoutSec === 'number' && codexPlan.hooks[0].timeout === undefined)
ok('the hooks Codex users configured themselves are kept',
  codexPost.some((e) => (e.hooks ?? []).some((h) => h.command === '/usr/bin/mine.sh')))

// Gemini CLI and Qwen Code each have a plan tool, in their own hook dialect:
// Gemini `AfterTool` on `write_todos` with timeouts in milliseconds; Qwen --
// a fork that went Claude-style -- `PostToolUse` on `todo_write`, in seconds.
// Each is inert if wrong, so each is asserted.
for (const [label, file, event, tool, timeout] of [
  ['Gemini CLI', '.gemini/settings.json', 'AfterTool', 'write_todos', 15000],
  ['Qwen Code', '.qwen/settings.json', 'PostToolUse', 'todo_write', 15]
]) {
  const cfg = JSON.parse(readFileSync(join(HOME, file), 'utf8'))
  const group = (cfg.hooks?.[event] ?? []).find((e) =>
    (e.hooks ?? []).some((h) => String(h.command ?? '').includes('todo-sync')))
  ok(`${label}: plan sync wired on ${event}, matched on ${tool}`,
    Boolean(group) && group.matcher === tool)
  ok(`${label}: timeout in the unit its own reference specifies`,
    group?.hooks[0].timeout === timeout)
  ok(`${label}: the MCP servers in the same file are untouched`,
    Boolean(cfg.mcpServers?.planide) && Boolean(cfg.mcpServers?.other))
}
{
  const qwenHooks = JSON.parse(readFileSync(join(HOME, '.qwen/settings.json'), 'utf8')).hooks
  ok('Qwen Code: the Gemini-named groups an earlier version left (inert there) are gone',
    !['AfterTool', 'BeforeAgent', 'AfterAgent', 'BeforeTool'].some((e) =>
      JSON.stringify(qwenHooks[e] ?? []).match(/todo-sync|keep-going|docs-guard/)))
  ok("Qwen Code: and the user's own hook under one of those names is kept",
    JSON.stringify(qwenHooks.AfterTool ?? []).includes('/usr/bin/qwen-mine.sh'))
}

ok('a redeploy leaves exactly one plan hook',
   postAgain.filter((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('todo-sync'))).length === 1)

// --- where to resume: a SessionStart hook of its own ------------------------ //
// The board knew what a previous session left half done; nothing told the next
// one. The resume brief is a second SessionStart entry beside the graphify
// bootstrap, running on node, and it has to land, stay single, and keep
// everyone else's hooks.
const startsAgain = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8')).hooks.SessionStart
const resumeEntries = startsAgain.filter((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('resume-brief')))
ok('the resume brief is wired as a SessionStart hook, exactly once after a redeploy',
  resumeEntries.length === 1)
ok('beside the graphify bootstrap and the user\'s own SessionStart hook, not instead of them',
  startsAgain.some((e) => JSON.stringify(e).includes('graphify-bootstrap')) &&
  startsAgain.some((e) => JSON.stringify(e).includes('mine.sh')))
const resumeLauncher = resumeEntries[0]?.hooks?.[0]?.command ?? ''
ok('its launcher and script are both on disk',
  existsSync(resumeLauncher) && existsSync(join(HOME, '.config/pulsaride/hooks/resume-brief.mjs')))
// Every agent with a session-start hook gets the same brief, in its own format:
// Codex `timeoutSec` (seconds), Gemini CLI `timeout` (ms), Qwen `timeout` (s).
// Verified against their own sources, not assumed alike.
{
  const codexStarts = JSON.parse(readFileSync(join(HOME, '.codex/hooks.json'), 'utf8')).hooks?.SessionStart ?? []
  const codexResume = codexStarts.filter((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('resume-brief')))
  ok('Codex gets the resume brief at session start, once, with the timeout field Codex accepts',
    codexResume.length === 1 && codexResume[0].hooks[0].timeoutSec === 15 &&
    codexResume[0].hooks[0].timeout === undefined && existsSync(codexResume[0].hooks[0].command))
  const codexPost = JSON.parse(readFileSync(join(HOME, '.codex/hooks.json'), 'utf8')).hooks?.PostToolUse ?? []
  ok('and Codex\'s already-trusted plan hook is untouched by it',
    codexPost.some((e) => e.matcher === 'update_plan'))
  for (const [label, file, timeout] of [['Gemini CLI', '.gemini/settings.json', 15000], ['Qwen Code', '.qwen/settings.json', 15]]) {
    const starts = JSON.parse(readFileSync(join(HOME, file), 'utf8')).hooks?.SessionStart ?? []
    const resume = starts.filter((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('resume-brief')))
    ok(`${label}: the resume brief is wired on SessionStart, once, in its own timeout unit`,
      resume.length === 1 && resume[0].hooks[0].timeout === timeout)
  }
}

// --- autopilot: the keep-going hook, on every agent that has the events ----- //
// The user's prompt and the end of the turn, under each agent's own names and
// timeout units: Claude Code UserPromptSubmit/Stop (seconds), Codex the same
// names with `timeoutSec`, Gemini CLI BeforeAgent/AfterAgent (ms), Qwen Code
// Claude's names with seconds.
{
  const claudeHooks = JSON.parse(readFileSync(join(HOME, '.claude/settings.json'), 'utf8')).hooks
  const ours = (groups) => (groups ?? []).filter((e) => (e.hooks ?? []).some((h) => String(h.command ?? '').includes('keep-going')))
  ok('autopilot: Claude Code gets the keep-going hook on UserPromptSubmit and Stop, once each',
    ours(claudeHooks.UserPromptSubmit).length === 1 && ours(claudeHooks.Stop).length === 1 &&
    ours(claudeHooks.Stop)[0].hooks[0].timeout === 15 &&
    existsSync(ours(claudeHooks.Stop)[0].hooks[0].command) &&
    existsSync(join(HOME, '.config/pulsaride/hooks/keep-going.mjs')))
  const codexHooks = JSON.parse(readFileSync(join(HOME, '.codex/hooks.json'), 'utf8')).hooks
  ok('autopilot: Codex gets it on the same two events, with timeoutSec',
    ours(codexHooks.UserPromptSubmit).length === 1 && ours(codexHooks.Stop).length === 1 &&
    ours(codexHooks.Stop)[0].hooks[0].timeoutSec === 15 && ours(codexHooks.Stop)[0].hooks[0].timeout === undefined)
  for (const [label, file, prompt, stop, write, timeout] of [
    ['Gemini CLI', '.gemini/settings.json', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 15000],
    ['Qwen Code', '.qwen/settings.json', 'UserPromptSubmit', 'Stop', 'PreToolUse', 15]
  ]) {
    const h = JSON.parse(readFileSync(join(HOME, file), 'utf8')).hooks
    ok(`autopilot: ${label} gets it on ${prompt} and ${stop}, in its own timeout unit`,
      ours(h[prompt]).length === 1 && ours(h[stop]).length === 1 &&
      ours(h[stop])[0].hooks[0].timeout === timeout)
    const guard = (h[write] ?? []).filter((e) => (e.hooks ?? []).some((x) => String(x.command ?? '').includes('docs-guard')))
    ok(`docs guard: ${label} gets it on ${write} write_file, once`,
      guard.length === 1 && guard[0].matcher === 'write_file' && guard[0].hooks[0].timeout === timeout)
  }
  const claudeGuard = (claudeHooks.PreToolUse ?? []).filter((e) => (e.hooks ?? []).some((x) => String(x.command ?? '').includes('docs-guard')))
  ok('docs guard: Claude Code gets it on PreToolUse Write, once, and its script is deployed',
    claudeGuard.length === 1 && claudeGuard[0].matcher === 'Write' &&
    existsSync(claudeGuard[0].hooks[0].command) && existsSync(join(HOME, '.config/pulsaride/hooks/docs-guard.mjs')))
  ok('docs: the shared sweep ships with the deployed tracker',
    existsSync(join(HOME, '.config/pulsaride/tracker/mcp/docs-tidy.mjs')) &&
    existsSync(join(HOME, '.config/pulsaride/tracker/mcp/sessions.mjs')))
}

// Both hooks import the shared work order from the DEPLOYED tracker
// (<config>/hooks -> ../tracker/mcp/work-queue.mjs). The repo tests prove the
// logic; this proves the deployed layout actually resolves it, through the very
// launchers the agents are handed.
if (process.platform !== 'win32') {
  const deployedProj = mkdtempSync(join(tmpdir(), 'pulsar-deployed-hooks-'))
  mkdirSync(join(deployedProj, '.git'))
  const todoLauncher = todoEntry.hooks[0].command
  execSync(`"${todoLauncher}"`, {
    input: JSON.stringify({ tool_name: 'TodoWrite', cwd: deployedProj, tool_input: { todos: [
      { content: 'Resume me', status: 'in_progress' }, { content: 'Then me', status: 'pending' }] } })
  })
  const deployedBoard = existsSync(join(deployedProj, '.planide/state.json'))
    ? JSON.parse(readFileSync(join(deployedProj, '.planide/state.json'), 'utf8'))
    : { items: [] }
  ok('the deployed plan hook finds the deployed tracker and writes the plan',
    deployedBoard.items.map((i) => `${i.title}:${i.status}`).join() === 'Resume me:wip,Then me:todo')
  const briefRaw = execSync(`"${resumeLauncher}"`, { input: JSON.stringify({ cwd: deployedProj, source: 'startup' }) }).toString()
  let briefCtx = ''
  try {
    briefCtx = JSON.parse(briefRaw).hookSpecificOutput.additionalContext
  } catch {
    briefCtx = ''
  }
  ok('the deployed resume hook hands a new session the item to finish first, then the todo',
    /finish first: "Resume me"/.test(briefCtx) && briefCtx.includes('Next todo: 1. "Then me"'))
  // The deployed autopilot finds the deployed tracker (work-queue + sessions) too.
  const goLauncher = join(HOME, '.config/pulsaride/hooks/keep-going.sh')
  const goRun = (payload) => execSync(`"${goLauncher}"`, { input: JSON.stringify(payload) }).toString()
  goRun({ hook_event_name: 'UserPromptSubmit', session_id: 'DEP', cwd: deployedProj, prompt: 'build it' })
  execSync(`"${todoLauncher}"`, {
    input: JSON.stringify({ tool_name: 'TodoWrite', session_id: 'DEP', cwd: deployedProj, tool_input: { todos: [
      { content: 'Built it', status: 'completed' }] } })
  })
  let stop = {}
  try {
    stop = JSON.parse(goRun({ hook_event_name: 'Stop', session_id: 'DEP', cwd: deployedProj, stop_hook_active: false }))
  } catch {
    stop = {}
  }
  ok('the deployed autopilot hands a turn that worked the board the next item instead of the stop',
    stop.decision === 'block' && /"Resume me"/.test(stop.reason || ''))

  // "Hook failed -- hook exited with code 1" in Codex: a hook is advisory, so a
  // crash inside one must reach the log, never the agent's session.
  const goScript = join(HOME, '.config/pulsaride/hooks/keep-going.mjs')
  const goSaved = readFileSync(goScript, 'utf8')
  writeFileSync(goScript, "throw new Error('boom from a broken hook')\n")
  const crashed = spawnSync(goLauncher, [], { input: '{}', encoding: 'utf8' })
  writeFileSync(goScript, goSaved)
  const hookLog = join(HOME, '.config/pulsaride/hooks/hook-errors.log')
  ok('a hook that crashes still exits 0, so the agent never shows "Hook failed"',
    crashed.status === 0 && crashed.stdout === '')
  ok('and what went wrong is in hooks/hook-errors.log instead',
    existsSync(hookLog) && readFileSync(hookLog, 'utf8').includes('boom from a broken hook'))
}

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
// The demo assets those components reference are vendored too -- gallery's five
// .webp files were missing, so it deployed with broken image references, which is
// what "the ThreeUI integration must actually work, including the assets" meant.
ok('the ThreeUI components that need demo assets get them',
  existsSync(join(HOME, '.config/pulsaride/design/threeui/gallery/assets/gallery-1.webp')) &&
  existsSync(join(HOME, '.config/pulsaride/design/threeui/section-elements/assets/testimonials-keyboard.svg')))
// The design-system library: 152 brand systems, searched with design_find and read
// with design_read. Deployed the same way, and useless without its catalogue.
ok('the design-system library is deployed, with its catalogue and licence',
  existsSync(join(HOME, '.config/pulsaride/design/design-systems/catalog.json')) &&
  existsSync(join(HOME, '.config/pulsaride/design/design-systems/LICENSE')) &&
  readdirSync(join(HOME, '.config/pulsaride/design/design-systems')).length > 100)
ok('each deployed design system carries a DESIGN.md and its tokens',
  existsSync(join(HOME, '.config/pulsaride/design/design-systems/apple/DESIGN.md')) &&
  existsSync(join(HOME, '.config/pulsaride/design/design-systems/apple/tokens.css')))
// The whole point of this round: a subagent that never hears about the library
// rebuilds it by hand. Council and the design leads must name the tools.
// Knowing the tools exist is the difference between a lead that calls route_task
// and one that answers as a generic assistant. This knowledge used to live only in
// the main-session instructions, so it vanished the moment work went to a subagent:
// route_task and record_solution were named in 0 of the 100 leads, ecc_find in 1.
ok('every deployed team lead knows the tools on this machine', (() => {
  const dir = join(HOME, '.claude/agents')
  const leads = readdirSync(dir).filter((f) => f.startsWith('pulse-') && f.endsWith('.md'))
  if (leads.length < 90) return false
  const missing = leads.filter((f) => {
    const body = readFileSync(join(dir, f), 'utf8')
    return !['route_task', 'check_anti_loop', 'record_solution', 'ecc_find',
             'agency-agents', 'design_find'].every((t) => body.includes(t))
  })
  if (missing.length) console.log('    leads missing tool knowledge:', missing.slice(0, 5).join(', '))
  return missing.length === 0
})())
ok('Council and the design team leads actually name the design tools',
  ['council', 'design-systems', 'web-frontend', 'specialized-creative'].every((a) =>
    /design_find/.test(readFileSync(join(HOME, '.claude/agents', `pulse-${a}.md`), 'utf8')) ||
    /design_find/.test(readFileSync(join(REPO, 'ide/agent-bundle/agents', `${a}.md`), 'utf8'))))
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

// --- a plan reaches the board from EVERY agent, not just Claude Code ------- //
// The assertions above prove each agent's config NAMES the server. That is not
// the same as the tracker working there, which is what was actually reported.
// So: take the launch out of each agent's own config file, run it exactly as
// that agent would, call sync_plan over real MCP frames, and read the board
// back. Anything that only ever worked in Claude Code fails right here.
//
// sync_plan is the todo list for every agent that is not Claude Code: the
// TodoWrite hook is Claude Code's own, so everywhere else this call IS the
// mechanism -- which is exactly why it has to be proven per agent.
const launchFromConfig = (file) => {
  const full = join(HOME, file)
  if (file.endsWith('.toml')) {
    const py = 'import tomllib,json;s=tomllib.load(open(' + JSON.stringify(full) +
      ",'rb'))['mcp_servers']['planide'];print(json.dumps(s))"
    const s = JSON.parse(execSync('python3 -c ' + JSON.stringify(py)).toString())
    return { command: s.command, args: s.args, env: s.env }
  }
  const cfg = JSON.parse(readFileSync(full, 'utf8'))
  if (cfg.mcp?.planide) { // opencode: one command array, env under `environment`
    const [command, ...args] = cfg.mcp.planide.command
    return { command, args, env: cfg.mcp.planide.environment }
  }
  const srv = cfg.mcpServers.planide
  return { command: srv.command, args: srv.args, env: srv.env }
}

/** Drive a planide server the way an agent does, and return the tool result. */
const callTool = (launch, name, args) =>
  new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(launch.env ?? {}) }
    })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => resolve({ error: String(e) }))
    child.on('close', () => {
      const replies = out.split('\n').filter(Boolean).flatMap((l) => {
        try { return [JSON.parse(l)] } catch { return [] }
      })
      resolve({ reply: replies.find((r) => r.id === 2), stderr: err })
    })
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } }
    }) + '\n')
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args }
    }) + '\n')
    child.stdin.end()
    setTimeout(() => child.kill(), 20000).unref?.()
  })

const AGENT_CONFIGS = [
  ['Claude Code', '.claude.json'],
  ['Codex CLI', '.codex/config.toml'],
  ['Gemini CLI', '.gemini/settings.json'],
  ['Antigravity', '.gemini/config/mcp_config.json'],
  ['Qwen Code', '.qwen/settings.json'],
  ['Cursor', '.cursor/mcp.json'],
  ['opencode', '.config/opencode/opencode.json']
]

const planProject = join(work, 'plan-e2e'); mkdirSync(planProject, { recursive: true })
const boardItems = () => {
  const f = join(planProject, '.planide/state.json')
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).items ?? []) : []
}
const titled = (t) => boardItems().find((i) => i.title === t)

for (const [label, file] of AGENT_CONFIGS) {
  const step = `step from ${label}`
  // A config this agent never got is the exact shape of the Antigravity bug, so
  // it has to read as a failed check for that agent -- not as a thrown error
  // that takes the whole suite down and says nothing about which agent broke.
  let res
  try {
    res = await callTool(launchFromConfig(file), 'sync_plan', {
      project: planProject,
      todos: [{ content: step, status: 'in_progress' }],
      agent: label
    })
  } catch (e) {
    res = { error: `no usable planide launch in ${file}: ${e.message}` }
  }
  ok(`${label}: a plan syncs to the board through its own registered launch`,
    !res.error && res.reply?.result && !res.reply.result.isError && titled(step)?.status === 'wip')
}

// The same board, written by seven different agents' launches: one project, one
// plan, no per-agent duplicates. That is the property a shared tracker needs.
ok('all seven agents wrote to the one board, each step once',
  boardItems().length === AGENT_CONFIGS.length &&
  new Set(boardItems().map((i) => i.title)).size === AGENT_CONFIGS.length)

// The hook path, end to end, through the launcher actually written to disk and
// named in Codex's own hooks.json -- not the source script, and not a stub.
// Claude Code's TodoWrite payload and Codex's update_plan payload both go in.
const hookProject = join(work, 'hook-e2e'); mkdirSync(join(hookProject, '.git'), { recursive: true })
const runHook = (payload) =>
  new Promise((resolve) => {
    const child = spawn(codexPlan.hooks[0].command, [], { stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', () => resolve(false))
    child.on('close', () => resolve(true))
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
const hookItems = () => {
  const f = join(hookProject, '.planide/state.json')
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).items ?? []) : []
}
// Codex's real shape: tool_input.plan, each step in `step`, snake_case status.
await runHook({ tool_name: 'update_plan', cwd: hookProject, tool_input: { explanation: 'x', plan: [
  { step: 'Codex finished this', status: 'completed' },
  { step: 'Codex is on this', status: 'in_progress' },
  { step: 'Codex will do this', status: 'pending' }
] } })
const byTitle = (t) => hookItems().find((i) => i.title === t)
ok('a Codex plan reaches the board through the deployed hook, no sync_plan call',
  // A finished step lands as done: auto-complete is on unless the user turns it off.
  byTitle('Codex finished this')?.status === 'done' &&
  byTitle('Codex is on this')?.status === 'wip' &&
  byTitle('Codex will do this')?.status === 'todo')
// Claude Code's shape through the very same launcher: one script, both agents.
await runHook({ tool_name: 'TodoWrite', cwd: hookProject, tool_input: { todos: [
  { content: 'Claude step', status: 'in_progress' }
] } })
ok('and the same launcher still serves Claude Code\'s own payload',
  byTitle('Claude step')?.status === 'wip')
// Gemini CLI's shape: tool_input.todos, text in `description`, plus the two
// statuses only it has. `blocked` is a real board column; `cancelled` is not,
// and a step the agent abandoned must not come back as outstanding work.
await runHook({ tool_name: 'write_todos', cwd: hookProject, tool_input: { todos: [
  { description: 'Gemini blocked step', status: 'blocked' },
  { description: 'Gemini cancelled step', status: 'cancelled' },
  { description: 'Gemini live step', status: 'in_progress' }
] } })
ok('a Gemini CLI plan reaches the board, blocked included',
  byTitle('Gemini blocked step')?.status === 'blocked' &&
  byTitle('Gemini live step')?.status === 'wip')
ok('a cancelled step is not resurrected as outstanding work',
  byTitle('Gemini cancelled step') === undefined)

// A matcher widened by hand must not turn a Bash call into a plan.
const beforeStray = hookItems().length
await runHook({ tool_name: 'Bash', cwd: hookProject, tool_input: { command: 'ls' } })
ok('a non-plan tool is ignored even if the matcher is widened by hand',
  hookItems().length === beforeStray)

// Re-sending a revised plan must move a step, never stack a second copy of it.
const revised = await callTool(launchFromConfig('.codex/config.toml'), 'sync_plan', {
  project: planProject,
  todos: [{ content: 'step from Codex CLI', status: 'completed' }],
  agent: 'Codex CLI'
})
ok('a revised plan moves the step it already knows instead of duplicating it',
  !revised.error && titled('step from Codex CLI')?.status === 'done' &&
  boardItems().filter((i) => i.title === 'step from Codex CLI').length === 1)

// ---- Headroom, off the machine ------------------------------------------ //
// It was never ours: the ThePunisher-Agent installer wired it into the shell
// profiles, and every terminal PulsarIDE opens loads them -- the console window
// that kept popping up. The cleanup removes its launch points, backs up what it
// touches, and refuses to cut a line out of the middle of someone's if-block.
{
  const HH = join(work, 'headroom-home'); mkdirSync(HH)
  const w = (rel, text) => { mkdirSync(dirname(join(HH, rel)), { recursive: true }); writeFileSync(join(HH, rel), text) }
  const r = (rel) => readFileSync(join(HH, rel), 'utf8')
  w('.bashrc', 'export PATH="$HOME/bin:$PATH"\n# Headroom context proxy\nsource "$HOME/.headroom/shell-hook.sh"\nalias ll="ls -l"\n')
  w('.zshrc', 'setopt autocd\n# >>> headroom >>>\nexport HEADROOM_ON=1\neval "$(headroom init zsh)"\n# <<< headroom <<<\nbindkey -e\n')
  // Headroom inside a block: deleting that line alone would break the profile.
  const psBlocked = 'if (Test-Path $hr) {\n  & headroom shell-hook\n}\n'
  w('Documents/PowerShell/Microsoft.PowerShell_profile.ps1', psBlocked)
  w('OneDrive - Work/Documents/WindowsPowerShell/profile.ps1', 'Set-Alias g git\n. "$HOME\\.headroom\\hook.ps1"\n')
  w('.claude/settings.json', JSON.stringify({
    env: { ANTHROPIC_BASE_URL: 'http://localhost:8787', KEEP_ME: '1' },
    hooks: { SessionStart: [{ hooks: [
      { type: 'command', command: '/home/x/.headroom/claude-hook.sh' },
      { type: 'command', command: '/home/x/.config/pulsaride/hooks/resume-brief.sh' }
    ] }] },
    mcpServers: { headroom: { command: 'headroom', args: ['mcp'] }, planide: { command: 'node' } }
  }, null, 2))
  w('.codex/config.toml', 'model = "gpt-5"\nopenai_base_url = "http://127.0.0.1:8787/v1"\n\n[mcp_servers.headroom]\ncommand = "headroom"\nargs = ["mcp"]\n\n[mcp_servers.planide]\ncommand = "node"\n')
  const appData = join(HH, 'AppData', 'Roaming')
  const startup = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  mkdirSync(startup, { recursive: true })
  writeFileSync(join(startup, 'headroom.vbs'), 'CreateObject("WScript.Shell").Run "headroom proxy", 0')
  writeFileSync(join(startup, 'onedrive.lnk'), 'not ours')

  const calls = []
  const fakeExec = async (file, args) => {
    calls.push([file, ...args].join(' '))
    if (file === 'reg' && args[0] === 'query' && /\\Run$/.test(args[1]))
      return '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    OneDrive    REG_SZ    "C:\\OneDrive.exe" /background\r\n    HeadroomProxy    REG_SZ    C:\\Users\\x\\.headroom\\headroom.exe proxy\r\n'
    if (file === 'reg' && args[0] === 'query')
      return '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\bin;C:\\Users\\x\\.headroom\\bin;C:\\tools\r\n    PYTHONPATH    REG_SZ    C:\\headroom-only\r\n    HEADROOM_HOME    REG_SZ    C:\\Users\\x\\.headroom\r\n    ANTHROPIC_BASE_URL    REG_SZ    http://localhost:8787\r\n'
    if (file === 'schtasks' && args[0] === '/Query')
      return '"PC","\\Headroom Updater","N/A","Ready","Interactive only","N/A","1","x","C:\\Users\\x\\.headroom\\update.cmd"\r\n"PC","\\OneDrive Standalone Update Task","N/A","Ready"\r\n'
    if (file === 'taskkill') throw new Error('not running')
    return ''
  }
  const rep = await removeHeadroom(HH, { platform: 'win32', exec: fakeExec, appData })
  const backups = join(HH, '.config/pulsaride/headroom-removed')

  ok('headroom: a sourced shell hook leaves .bashrc, the rest stays',
    r('.bashrc') === 'export PATH="$HOME/bin:$PATH"\nalias ll="ls -l"\n')
  ok('headroom: a marked block leaves .zshrc whole, nothing around it',
    r('.zshrc') === 'setopt autocd\nbindkey -e\n')
  ok('headroom: a line inside someone\'s if-block is left alone and reported',
    r('Documents/PowerShell/Microsoft.PowerShell_profile.ps1') === psBlocked &&
    rep.traces.some((t) => t.action === 'manual' && /Microsoft\.PowerShell_profile/.test(t.where)))
  ok('headroom: a OneDrive-moved PowerShell profile is found too',
    r('OneDrive - Work/Documents/WindowsPowerShell/profile.ps1') === 'Set-Alias g git\n')
  const cs = JSON.parse(r('.claude/settings.json'))
  ok('headroom: Claude settings lose its env redirect, hook and MCP -- ours stay',
    cs.env.ANTHROPIC_BASE_URL === undefined && cs.env.KEEP_ME === '1' &&
    cs.hooks.SessionStart[0].hooks.length === 1 &&
    /resume-brief/.test(cs.hooks.SessionStart[0].hooks[0].command) &&
    !cs.mcpServers.headroom && cs.mcpServers.planide)
  ok('headroom: Codex loses its MCP table and proxy base_url, keeps the rest',
    !/headroom|8787/.test(r('.codex/config.toml')) &&
    /model = "gpt-5"/.test(r('.codex/config.toml')) && /\[mcp_servers\.planide\]/.test(r('.codex/config.toml')))
  const stampDir = join(backups, readdirSync(backups)[0] ?? '')
  ok('headroom: every changed file has a backup with the original in it, laid out as in home',
    readdirSync(backups).length === 1 &&
    /shell-hook\.sh/.test(readFileSync(join(stampDir, '.bashrc'), 'utf8')) &&
    /claude-hook/.test(readFileSync(join(stampDir, '.claude/settings.json'), 'utf8')) &&
    /\[mcp_servers\.headroom\]/.test(readFileSync(join(stampDir, '.codex/config.toml'), 'utf8')))
  ok('headroom: its Startup entry is moved out, the others stay',
    !existsSync(join(startup, 'headroom.vbs')) && existsSync(join(startup, 'onedrive.lnk')))
  ok('headroom: only its Run value, its own variable and the env redirect are deleted from the registry',
    calls.includes('reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v HeadroomProxy /f') &&
    calls.includes('reg delete HKCU\\Environment /v ANTHROPIC_BASE_URL /f') &&
    calls.includes('reg delete HKCU\\Environment /v HEADROOM_HOME /f') &&
    !calls.some((c) => /delete .* \/v (OneDrive|Path|PYTHONPATH) /.test(c)))
  // 0.98.0 deleted a whole user Path for one Headroom folder in it.
  ok('headroom: a user Path loses only its Headroom folder -- every other folder stays, type kept',
    calls.includes('reg add HKCU\\Environment /v Path /t REG_EXPAND_SZ /d C:\\bin;C:\\tools /f'))
  ok('headroom: a variable that is nothing but a Headroom path is reported, not deleted',
    !calls.some((c) => /PYTHONPATH/.test(c) && /delete|add/.test(c)) &&
    rep.traces.some((t) => t.action === 'manual' && /PYTHONPATH/.test(t.where)))
  ok('headroom: the report keeps the full previous value of everything it changed in the registry',
    rep.traces.some((t) => /\\Path$/.test(t.where) && t.previous === 'C:\\bin;C:\\Users\\x\\.headroom\\bin;C:\\tools'))
  ok('headroom: only its scheduled task is deleted',
    calls.includes('schtasks /Delete /TN \\Headroom Updater /F') &&
    !calls.some((c) => /Delete .*OneDrive/.test(c)))
  const mk = JSON.parse(readFileSync(join(HH, '.config/pulsaride/headroom-cleanup.json'), 'utf8'))
  ok('headroom: the report is kept beside the backups', mk.systemPass >= 1 && mk.last.traces.length >= 8)

  // Second launch: nothing left to remove, and the Windows half does not spawn again.
  calls.length = 0
  const rep2 = await removeHeadroom(HH, { platform: 'win32', exec: fakeExec, appData })
  ok('headroom: a second launch removes nothing and spawns nothing',
    !rep2.traces.some((t) => t.action === 'removed') && calls.length === 0 &&
    readdirSync(backups).length === 1)

  // Its installer runs again: the file half finds it, so the Windows half re-runs.
  writeFileSync(join(HH, '.bashrc'), r('.bashrc') + 'source ~/.headroom/shell-hook.sh\n')
  const rep3 = await removeHeadroom(HH, { platform: 'win32', exec: fakeExec, appData })
  ok('headroom: back after a re-install -> removed again, Windows half re-run',
    !/headroom/.test(r('.bashrc')) && rep3.traces.some((t) => t.action === 'removed') &&
    calls.some((c) => c.startsWith('schtasks /Query')))

  // A user Path 0.98.0 deleted: put back from the environment the app still runs with.
  {
    const PH = join(work, 'path-home'); mkdirSync(join(PH, '.config/pulsaride'), { recursive: true })
    writeFileSync(join(PH, '.config/pulsaride/headroom-cleanup.json'), JSON.stringify({ systemPass: 1, last: null }))
    const added = []
    const pathExec = async (file, args) => {
      if (file === 'reg' && args[0] === 'query' && args[1] === 'HKCU\\Environment')
        return '\r\nHKEY_CURRENT_USER\\Environment\r\n    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp\r\n'
      if (file === 'reg' && args[0] === 'query')
        return '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\Git\\cmd\r\n'
      if (file === 'reg' && args[0] === 'add') added.push(args.join(' '))
      if (file === 'taskkill' || file === 'schtasks') throw new Error('n/a')
      return ''
    }
    const env = {
      SystemRoot: 'C:\\Windows',
      Path: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps;' +
        'C:\\Users\\x\\AppData\\Roaming\\npm;C:\\Users\\x\\.headroom\\bin;C:\\Program Files\\PulsarIDE\\resources\\bin'
    }
    const r1 = await removeHeadroom(PH, { platform: 'win32', exec: pathExec, env, appFolders: ['C:\\Program Files\\PulsarIDE'] })
    ok('headroom: a deleted user Path is put back from the live environment, minus machine, Headroom and app folders',
      added.length === 1 &&
      added[0] === 'add HKCU\\Environment /v Path /t REG_EXPAND_SZ /d C:\\Users\\x\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Users\\x\\AppData\\Roaming\\npm /f' &&
      r1.traces.some((t) => t.action === 'restored'))
    await removeHeadroom(PH, { platform: 'win32', exec: pathExec, env, appFolders: ['C:\\Program Files\\PulsarIDE'] })
    ok('headroom: and it does that once', added.length === 1)
  }

  // A clean machine: nothing written, nothing spawned beyond the one-time pass.
  const clean = join(work, 'clean-home'); mkdirSync(clean)
  writeFileSync(join(clean, '.bashrc'), 'alias ll="ls -l"\n')
  const repClean = await removeHeadroom(clean, { platform: 'linux' })
  ok('headroom: a clean machine is left exactly as it was',
    repClean.traces.length === 0 && readFileSync(join(clean, '.bashrc'), 'utf8') === 'alias ll="ls -l"\n' &&
    !existsSync(join(clean, '.config/pulsaride/headroom-removed')))

  // The pure rules, pinned.
  ok('headroom: a continued line is never cut in half',
    stripHeadroomLines('headroom start \\\n  --port 8787\n').blocked === true)
  ok('headroom: an unclosed marker block changes nothing',
    stripHeadroomLines('# >>> headroom >>>\nexport X=1\n').blocked === true)
  ok('headroom: CRLF profiles keep their line endings',
    stripHeadroomLines('a\r\nheadroom on\r\nb\r\n').text === 'a\r\nb\r\n')
  ok('headroom: the only statement of a bash then-block is left alone',
    stripHeadroomLines('if [ -f ~/.hr ]; then\n  headroom hook\nfi\n').blocked === true)
  ok('headroom: a top-level line after a closed block still goes',
    stripHeadroomLines('if x; then\n  y\nfi\n[ -f ~/.hr ] && source ~/.headroom/hook.sh\n').text === 'if x; then\n  y\nfi\n')
  ok('headroom: a variable it sets that the rest still reads keeps everything (bash)',
    stripHeadroomLines('HR="$HOME/.headroom/hook.sh"\nif [ -f "$HR" ]; then\n  . "$HR"\nfi\n').blocked === true)
  ok('headroom: ...and in PowerShell, case-insensitively',
    stripHeadroomLines('$Hook = "$HOME\\.headroom\\hook.ps1"\nif (Test-Path $hook) { . $hook }\n', 'powershell').blocked === true)
  ok('headroom: a variable nobody else reads goes with its line',
    stripHeadroomLines('export HEADROOM_PORT=8787\nalias ll="ls -l"\n').text === 'alias ll="ls -l"\n')
  ok('headroom: a fish function body is left alone',
    stripHeadroomLines('function hr\n  headroom on\nend\n', 'fish').blocked === true)
  ok('headroom: a TOML table after its table is kept',
    stripHeadroomToml('[mcp_servers.headroom]\ncommand = "x"\n[other]\nk = 1\n').text === '[other]\nk = 1\n')
}

// ---- hook doctor: hooks that can never run ------------------------------ //
// "Hook failed, exit code 1" with nothing in our log: a hook someone else left
// pointing at a script that is gone. Read, never run; taken out of action --
// in Codex kept in its place, because Codex trusts hooks by position.
{
  const DH = join(work, 'doctor-home')
  mkdirSync(join(DH, '.codex'), { recursive: true })
  mkdirSync(join(DH, '.claude'), { recursive: true })
  const realScript = join(DH, 'tools', 'real-hook.sh'); mkdirSync(dirname(realScript), { recursive: true })
  writeFileSync(realScript, '#!/bin/sh\nexit 0\n')
  const ours = join(DH, '.config', 'pulsaride', 'hooks', 'keep-going.sh')
  const codexHooks = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: `powershell -NoProfile -File "${join(DH, 'gone', 'old-orca-hook.ps1')}"`, timeoutSec: 10 }] },
        { hooks: [{ type: 'command', command: `"${ours}"`, timeoutSec: 15 }] },
        { hooks: [{ type: 'command', command: `sh ${realScript}`, timeoutSec: 5 }] }
      ],
      Stop: [
        { hooks: [{ type: 'command', command: 'definitely-not-a-real-program-xyz --flag' }] },
        { hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.hooks/x.sh"' }] }
      ]
    }
  }
  writeFileSync(join(DH, '.codex', 'hooks.json'), JSON.stringify(codexHooks, null, 2))
  writeFileSync(join(DH, '.claude', 'settings.json'), JSON.stringify({
    theme: 'dark',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
      { type: 'command', command: `python3 ${join(DH, 'gone', 'guard.py')}` },
      { type: 'command', command: `sh ${realScript}` }
    ] }] }
  }, null, 2))
  const rep = runHookDoctor(DH, { env: { PATH: '/usr/bin:/bin', HOME: DH }, platform: 'linux' })
  const cx = JSON.parse(readFileSync(join(DH, '.codex', 'hooks.json'), 'utf8')).hooks
  ok('hook doctor: a Codex hook whose script is gone is kept in its place, doing nothing',
    cx.UserPromptSubmit.length === 3 && cx.UserPromptSubmit[0].hooks[0].command === 'exit 0' &&
    cx.UserPromptSubmit[0].hooks[0].timeoutSec === 10)
  ok("hook doctor: so the hooks after it keep their position -- and the user's trust in them",
    cx.UserPromptSubmit[1].hooks[0].command === `"${ours}"` && cx.UserPromptSubmit[2].hooks[0].command === `sh ${realScript}`)
  ok('hook doctor: a program not on PATH is reported, not touched; an unresolvable variable path is left alone',
    cx.Stop[0].hooks[0].command === 'definitely-not-a-real-program-xyz --flag' &&
    cx.Stop[1].hooks[0].command === '"$CLAUDE_PROJECT_DIR/.hooks/x.sh"' &&
    rep.issues.some((i) => i.disabled === false && /not on PATH/.test(i.problem)) &&
    !rep.issues.some((i) => /CLAUDE_PROJECT_DIR/.test(i.command)))
  const cl = JSON.parse(readFileSync(join(DH, '.claude', 'settings.json'), 'utf8'))
  ok('hook doctor: in Claude Code the broken hook is removed, the working one and the rest of the file stay',
    cl.theme === 'dark' && cl.hooks.PreToolUse[0].hooks.length === 1 &&
    cl.hooks.PreToolUse[0].hooks[0].command === `sh ${realScript}`)
  ok("hook doctor: PulsarIDE's own hooks are never judged here", !rep.issues.some((i) => i.command.includes('keep-going')))
  ok('hook doctor: every changed config is backed up first, and the report is kept for the Toolkit',
    readdirSync(join(DH, '.config', 'pulsaride', 'hook-doctor')).length === 1 &&
    existsSync(join(DH, '.config', 'pulsaride', 'hook-doctor.json')) &&
    rep.issues.filter((i) => i.disabled).length === 2)
  const again = runHookDoctor(DH, { env: { PATH: '/usr/bin:/bin', HOME: DH }, platform: 'linux' })
  ok('hook doctor: a second run changes nothing and still shows what was taken out',
    readdirSync(join(DH, '.config', 'pulsaride', 'hook-doctor')).length === 1 &&
    again.issues.filter((i) => i.disabled).length === 2)
}

// Codex trusts hooks by position: a redeploy (every update) must leave ours
// where they are, not take them out and append them at the end -- that
// untrusted them and every hook after them after each update.
{
  const file = join(HOME, '.codex/hooks.json')
  const cfg = JSON.parse(readFileSync(file, 'utf8'))
  const theirs = { hooks: [{ type: 'command', command: '/usr/bin/added-after-ours.sh', timeoutSec: 5 }] }
  cfg.hooks.Stop = [...(cfg.hooks.Stop ?? []), theirs]
  writeFileSync(file, JSON.stringify(cfg, null, 2))
  const before = JSON.parse(readFileSync(file, 'utf8')).hooks
  const at = (h, ev, key) => (h[ev] ?? []).findIndex((g) => JSON.stringify(g).includes(key))
  deployAgentBundle({ home: HOME, resourcesPath: res, provisionPyEnv: false, force: true })
  const after = JSON.parse(readFileSync(file, 'utf8')).hooks
  ok('Codex: a redeploy keeps every hook group of ours at the position it had, so its trust holds',
    ['SessionStart', 'UserPromptSubmit', 'Stop', 'PostToolUse'].every((ev) =>
      ['resume-brief', 'keep-going', 'todo-sync'].every((k) => at(before, ev, k) === at(after, ev, k))) &&
    at(after, 'Stop', 'keep-going') < at(after, 'Stop', 'added-after-ours'))
  ok('Codex: and the hooks after ours keep theirs', at(before, 'Stop', 'added-after-ours') === at(after, 'Stop', 'added-after-ours'))
}

// ---- hook commands each agent's shell can actually start --------------- //
// Codex and Gemini run a hook through PowerShell on Windows, Claude Code
// through Git Bash: a bare backslash path was read as escapes by bash, and a
// path with a space split into a command that does not exist in PowerShell --
// "hook exited with code 1" before our script, or its log, ever started.
{
  const plain = 'C:\\Users\\Jax\\.config\\pulsaride\\hooks\\keep-going.cmd'
  const spaced = "C:\\Users\\Jax O'Neil\\.config\\pulsaride\\hooks\\keep-going.cmd"
  ok('hook command: Git Bash gets forward slashes (bash reads backslashes as escapes)',
    hookCommand(plain, 'git-bash', 'win32') === 'C:/Users/Jax/.config/pulsaride/hooks/keep-going.cmd')
  ok('hook command: ...and a path with a space quoted for bash',
    hookCommand(spaced, 'git-bash', 'win32') === `"C:/Users/Jax O'Neil/.config/pulsaride/hooks/keep-going.cmd"`)
  ok('hook command: a plain path stays exactly as it was for PowerShell (Codex keeps trusting it)',
    hookCommand(plain, 'powershell', 'win32') === plain)
  ok("hook command: a path with a space goes through PowerShell's call operator, quote doubled",
    hookCommand(spaced, 'powershell', 'win32') === "& 'C:\\Users\\Jax O''Neil\\.config\\pulsaride\\hooks\\keep-going.cmd'")
  ok('hook command: on macOS/Linux a plain path is bare, one with a space single-quoted',
    hookCommand('/home/jax/.config/pulsaride/hooks/k.sh', 'powershell', 'linux') === '/home/jax/.config/pulsaride/hooks/k.sh' &&
    hookCommand('/Users/Jax Smith/.config/pulsaride/hooks/k.sh', 'git-bash', 'darwin') === "'/Users/Jax Smith/.config/pulsaride/hooks/k.sh'")
  // And the shell really starts it: a launcher under a folder with a space.
  const dir = join(work, 'with space', '.config', 'pulsaride', 'hooks')
  mkdirSync(dir, { recursive: true })
  const sh = join(dir, 'probe.sh')
  writeFileSync(sh, '#!/bin/sh\ncat >/dev/null\necho started\n')
  spawnSync('chmod', ['+x', sh])
  const r = spawnSync('/bin/sh', ['-c', hookCommand(sh, 'git-bash', 'linux')], { input: '{}', encoding: 'utf8' })
  ok('hook command: sh starts a launcher whose path has a space', r.status === 0 && r.stdout.trim() === 'started')
}

// The Windows-only ways a hook can never run, judged without running it.
{
  const WH = join(work, 'doctor-win')
  mkdirSync(join(WH, '.codex'), { recursive: true })
  const script = join(WH, 'tools', 'notify.sh'); mkdirSync(dirname(script), { recursive: true })
  writeFileSync(script, '#!/bin/sh\nexit 0\n')
  writeFileSync(join(WH, '.codex', 'hooks.json'), JSON.stringify({ hooks: {
    PreToolUse: [
      { matcher: 'shell', hooks: [{ type: 'command', command: script }] },
      { hooks: [{ type: 'command', command: `bash ${script}` }] },
      { hooks: [{ type: 'command', command: `${join(WH, '.config', 'pulsaride', 'hooks', 'x.cmd')}` }] }
    ]
  } }, null, 2))
  const rep = runHookDoctor(WH, { env: { PATH: join(WH, 'empty-bin'), HOME: WH }, platform: 'win32' })
  const pre = JSON.parse(readFileSync(join(WH, '.codex', 'hooks.json'), 'utf8')).hooks.PreToolUse
  ok('hook doctor (Windows): a .sh started by itself, and bash where Windows has none, are taken out in place',
    pre.length === 3 && pre[0].hooks[0].command === 'exit 0' && pre[1].hooks[0].command === 'exit 0' &&
    pre[0].matcher === 'shell' && rep.issues.filter((i) => i.disabled).length === 2)
  ok('hook doctor: every Codex hook is listed for the Toolkit, ours marked as ours',
    rep.codex.length === 3 && rep.codex.filter((e) => e.ours).length === 1 && rep.codex[0].matcher === 'shell')
}

// Shell code is not a program name. Orca 1.4.2xx writes its own managed hooks
// as `if [ -f '<hook>' ]; then ...; fi`, guarding a missing file itself: the
// first boot on it listed 13 hooks with '"if" is not on PATH'.
{
  const SH = join(work, 'doctor-shell')
  mkdirSync(join(SH, '.claude'), { recursive: true })
  mkdirSync(join(SH, '.codex'), { recursive: true })
  const wrapped = "if [ -f '/home/x/.pulsar/agent-hooks/claude-hook.sh' ] && [ -r '/home/x/.pulsar/agent-hooks/claude-hook.sh' ]; then /bin/sh '/home/x/.pulsar/agent-hooks/claude-hook.sh'; else cat >/dev/null; fi"
  writeFileSync(join(SH, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: wrapped }] }] } }))
  writeFileSync(join(SH, '.codex', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [
    { hooks: [{ type: 'command', command: "& 'C:\\gone\\notify.ps1'" }] },
    { hooks: [{ type: 'command', command: 'if (Test-Path x) { & x }; exit 0' }] }
  ] } }))
  const rep = runHookDoctor(SH, { env: { PATH: '/usr/bin:/bin', HOME: SH }, platform: 'win32' })
  const pre = JSON.parse(readFileSync(join(SH, '.codex', 'hooks.json'), 'utf8')).hooks.PreToolUse
  ok('hook doctor: a hook written as shell code is not read as a program called "if"',
    !rep.issues.some((i) => /"if"/.test(i.problem)) &&
    JSON.parse(readFileSync(join(SH, '.claude', 'settings.json'), 'utf8')).hooks.Stop[0].hooks[0].command === wrapped)
  ok("hook doctor: PowerShell's call operator is looked through -- a script it calls that is gone is taken out",
    pre[0].hooks[0].command === 'exit 0' && pre[1].hooks[0].command.startsWith('if (Test-Path'))
}

// "Test hooks": each Codex hook run once the way Codex runs it, so a failing
// one gets a name -- and can be turned off where it stands.
{
  const TH = join(work, 'hooktest-home')
  mkdirSync(join(TH, '.codex'), { recursive: true })
  const reads = join(TH, 'reads.sh'); writeFileSync(reads, '#!/bin/sh\ncat > "$0.in"\nexit 0\n'); spawnSync('chmod', ['+x', reads])
  const file = join(TH, '.codex', 'hooks.json')
  writeFileSync(file, JSON.stringify({ hooks: {
    PreToolUse: [
      { matcher: 'shell', hooks: [{ type: 'command', command: reads }] },
      { hooks: [{ type: 'command', command: 'echo "broken notifier" >&2; exit 1' }] },
      { hooks: [{ type: 'command', command: 'echo "$ORCA_PANE_KEY" > /dev/null; test -z "$ORCA_PANE_KEY"' }] }
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'echo "broken notifier" >&2; exit 1' }] }]
  } }, null, 2))
  const env = { PATH: process.env.PATH, HOME: TH, SHELL: '/bin/sh', ORCA_PANE_KEY: 'pane-1' }
  const runs = await runHookTest(TH, { env, platform: 'linux' })
  const failing = runs.filter((r) => !r.ok)
  ok('hook test: the hook that exits 1 is named, with what it printed',
    failing.length === 2 && failing.every((r) => r.code === 1 && r.output === 'broken notifier'))
  ok('hook test: working hooks pass, fed a sample of their event on stdin',
    runs.filter((r) => r.ok).length === 2 &&
    JSON.parse(readFileSync(`${reads}.in`, 'utf8')).hook_event_name === 'PreToolUse' &&
    JSON.parse(readFileSync(`${reads}.in`, 'utf8')).tool_input.command === 'echo pulsaride-hook-test')
  ok("hook test: run outside an Orca pane (no ORCA_PANE_KEY), in an empty folder that is cleaned up",
    runs[2].ok === true && !JSON.parse(readFileSync(`${reads}.in`, 'utf8')).cwd.includes(TH) &&
    !existsSync(JSON.parse(readFileSync(`${reads}.in`, 'utf8')).cwd))
  ok('hook test: only a file the app knows can be rewritten',
    turnOffCodexHook({ file: join(TH, 'elsewhere.json'), event: 'Stop', command: 'x' }, { home: TH }) === false)
  const off = turnOffCodexHook({ file, event: 'PreToolUse', command: failing[0].command }, { home: TH })
  const after = JSON.parse(readFileSync(file, 'utf8')).hooks
  ok('hook test: Turn off makes that hook `exit 0` in its place, the rest untouched, file backed up',
    off === true && after.PreToolUse.length === 3 && after.PreToolUse[1].hooks[0].command === 'exit 0' &&
    after.PreToolUse[0].hooks[0].command === reads && after.Stop[0].hooks[0].command.includes('exit 1') &&
    readdirSync(join(TH, '.config', 'pulsaride', 'hook-doctor')).length >= 1)
  const rerun = await runHookTest(TH, { env, platform: 'linux' })
  ok('hook test: a turned-off hook is not run again', rerun.length === 3 && rerun.filter((r) => !r.ok).length === 1)
}

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
