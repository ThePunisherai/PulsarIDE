/**
 * OpenDesign integration test: the real module, driven against a fake `od`.
 *
 * There is no OpenDesign install here, so the CLI is stood in for by a script
 * on PATH. That is the point: it proves we detect it, parse what it prints, and
 * report its failures verbatim -- without ever needing the real tool, and
 * without inventing a config format for it.
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MOD = process.env.PULSAR_OPENDESIGN_CJS
const { openDesignStatus, connectOpenDesignToAgents, pickOpenDesignAsset} = await import(MOD)

let pass = 0, fail = 0
const ok = (n, c) => c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n))

const work = mkdtempSync(join(tmpdir(), 'pulsar-od-'))
const bin = join(work, 'bin'); mkdirSync(bin)
const HOME = join(work, 'home'); mkdirSync(HOME)

/** Write a stand-in `od` that answers the three calls the module makes. */
function fakeOd(body) {
  const p = join(bin, 'od')
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(p, 0o755)
}

// --- not installed: a normal state, never an error ------------------------- //
const away = { ...process.env }
process.env.PATH = '/nonexistent-for-this-test'
const missing = openDesignStatus(HOME)
ok('od absent -> installed false, no error (a normal "not yet" state)',
  missing.installed === false && missing.binary === null && missing.error === null)
ok('od absent -> connect reports every agent as not installed, never throws',
  connectOpenDesignToAgents(['claude', 'codex'], HOME).every((r) => !r.ok && /not installed/i.test(r.output)))
process.env.PATH = `${bin}:${away.PATH}`

// --- installed, projects as a bare array ----------------------------------- //
fakeOd(`
case "$1 $2" in
  "--version ") echo "od 1.4.2" ;;
  "project list") echo '[{"id":"a1","name":"Landing page","path":"/p/landing","updatedAt":"2026-08-01"}]' ;;
  "mcp install") echo "installed OpenDesign MCP for $3" ;;
esac
`)
const s = openDesignStatus(HOME)
ok('od on PATH is detected', s.installed === true && String(s.binary).endsWith('/od'))
ok('version is read from the CLI', s.version === 'od 1.4.2')
ok('projects parse from a bare array', s.projects.length === 1 && s.projects[0].name === 'Landing page')
ok('project fields are carried through', s.projects[0].path === '/p/landing' && s.projects[0].id === 'a1')
ok('no error when everything works', s.error === null)

// --- the other envelope shape: { projects: [...] } ------------------------- //
fakeOd(`
case "$1 $2" in
  "--version ") echo "od 1.4.2" ;;
  "project list") echo '{"projects":[{"title":"Deck","dir":"/p/deck"},{"name":"Dash","path":"/p/dash"}]}' ;;
esac
`)
const s2 = openDesignStatus(HOME)
ok('projects parse from a {projects:[...]} wrapper', s2.projects.length === 2)
ok('title/dir are accepted as name/path aliases',
  s2.projects[0].name === 'Deck' && s2.projects[0].path === '/p/deck')

// --- a CLI that prints junk must not crash or invent projects -------------- //
fakeOd(`
case "$1 $2" in
  "--version ") echo "od 9" ;;
  "project list") echo 'not json at all' ;;
esac
`)
const s3 = openDesignStatus(HOME)
ok('unparseable project output -> empty list, still reported installed',
  s3.installed === true && s3.projects.length === 0)

// --- connect: od's OWN output, successes and failures alike ---------------- //
fakeOd(`
if [ "$1 $2" = "mcp install" ]; then
  if [ "$3" = "nope" ]; then echo "unknown agent: nope" >&2; exit 1; fi
  echo "wired $3"; exit 0
fi
`)
const res = connectOpenDesignToAgents(['claude', 'nope'], HOME)
ok('connect runs per agent and reports each one', res.length === 2)
ok("a supported agent reports od's success output",
  res[0].agent === 'claude' && res[0].ok === true && res[0].output.includes('wired claude'))
ok('an unsupported agent fails VISIBLY with the real message, not silently skipped',
  res[1].agent === 'nope' && res[1].ok === false && res[1].output.includes('unknown agent'))

// --- coreutils `od` must not be mistaken for OpenDesign ------------------- //
// Found in a running build: `which od` returns /usr/bin/od on essentially every
// Linux and macOS machine, so the panel reported OpenDesign INSTALLED and then
// showed `od: unrecognized option '--json'` where the project list belongs.
fakeOd(`
case "$1" in
  --version) echo "od (GNU coreutils) 9.4"; echo "Copyright (C) 2023 Free Software Foundation, Inc."; exit 0 ;;
esac
echo "od: unrecognized option '--json'" >&2; exit 1
`)
const coreutils = openDesignStatus(HOME)
ok('coreutils od on PATH is not reported as OpenDesign',
  coreutils.installed === false && coreutils.binary === null)
ok('coreutils od does not produce a scary error either -- it is simply absent',
  coreutils.error === null)
ok('connect refuses cleanly when the only od is coreutils',
  connectOpenDesignToAgents(['claude'], HOME).every((r) => !r.ok && /not installed/i.test(r.output)))

// A real OpenDesign that has no --version at all must still be accepted: an
// inconclusive probe may not reject, or a genuine install disappears.
fakeOd(`
case "$1 $2" in
  "project list") echo '[]' ;;
  *) echo "no such option" >&2; exit 2 ;;
esac
`)
const quiet = openDesignStatus(HOME)
ok('a binary with no --version is still accepted (inconclusive never rejects)',
  quiet.installed === true)

// --- picking the right download ------------------------------------------- //
// OpenDesign publishes several assets per release. Handing macOS an .exe, or an
// Apple Silicon machine the Intel build, installs something that cannot run --
// so the choice is worth pinning down.
const assets = [
  { name: 'OpenDesign-0.21.1-win-x64.exe', browser_download_url: 'u1' },
  { name: 'OpenDesign-0.21.1-mac-arm64.dmg', browser_download_url: 'u2' },
  { name: 'OpenDesign-0.21.1-mac-x64.dmg', browser_download_url: 'u3' },
  { name: 'OpenDesign-0.21.1-linux-x86_64.AppImage', browser_download_url: 'u4' },
  { name: 'OpenDesign-0.21.1-sources.tar.gz', browser_download_url: 'u5' }
]
ok('windows takes the .exe', pickOpenDesignAsset(assets, 'win32', 'x64').name.endsWith('.exe'))
ok('linux takes the AppImage', pickOpenDesignAsset(assets, 'linux', 'x64').name.endsWith('.AppImage'))
ok('apple silicon takes the arm64 dmg',
   pickOpenDesignAsset(assets, 'darwin', 'arm64').name.includes('arm64'))
ok('an intel mac takes the x64 dmg, not the arm one',
   pickOpenDesignAsset(assets, 'darwin', 'x64').name.includes('x64'))
// A release that does not split the architectures must still install.
const oneDmg = [{ name: 'OpenDesign.dmg', browser_download_url: 'u' }]
ok('one undifferentiated dmg is still picked', pickOpenDesignAsset(oneDmg, 'darwin', 'arm64').name === 'OpenDesign.dmg')
ok('a release with nothing for this platform is refused, not guessed',
   pickOpenDesignAsset([{ name: 'notes.txt', browser_download_url: 'u' }], 'win32', 'x64') === null)

console.log(`\nPASS=${pass} FAIL=${fail}`)
process.exit(fail ? 1 : 0)
