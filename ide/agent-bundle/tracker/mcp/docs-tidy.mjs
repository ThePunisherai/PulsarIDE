/**
 * One place for a project's docs: `docs/`.
 *
 * Asked for directly: "waarom als er docs gemaakt worden wordt het niet in een
 * map aangemaakt, in plaats van heel veel md-bestanden ... bij bestaande alles
 * in een docs-map verplaatsen, in de toekomst alleen daar aanmaken, en zodra
 * een project af is alle docs lezen en één duidelijk document maken".
 *
 * Three parts, all here so every caller agrees on what a "loose doc" is:
 *
 *  - sweepDocs: the loose docs at a project's root (PLAN.md, SUMMARY.md,
 *    notes.pdf, ...) move into docs/. The files every tool expects at the root
 *    stay -- README, CHANGELOG, LICENSE, CONTRIBUTING, AGENTS.md, CLAUDE.md and
 *    the like. Relative links are rewritten both ways, so a moved doc still
 *    points at the code it names and README still points at the moved doc.
 *    Nothing is ever overwritten or deleted: a name already taken in docs/
 *    gets a suffix, an identical copy is the only file removed.
 *  - isLooseDocPath: the same rule for one path, for the hook that stops an
 *    agent writing a new loose doc in the first place.
 *  - docsNeedBundling / BUNDLE_TITLE: when the board is clear and docs/ holds
 *    more than one document, the work of reading them all and writing one
 *    clear docs/README.md becomes a board item like any other.
 *
 * Root only, and only projects PulsarIDE tracks (callers check .planide/):
 * docs inside packages and folders are where someone put them on purpose.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'

/** Where the docs live, relative to the project root. */
export const DOCS_DIR = 'docs'

/** What a finished project's docs/ is bundled into. */
export const BUNDLE_FILE = 'README.md'

/** The board item that asks for the bundle -- one title, so it is never added twice. */
export const BUNDLE_TITLE = 'Bundle the docs into one clear document (docs/README.md)'

const DOC_EXT = new Set(['.md', '.markdown', '.pdf', '.docx', '.doc', '.odt', '.rtf'])
const TEXT_EXT = new Set(['.md', '.markdown'])

/**
 * Root files tools and people expect at the root, by stem (case-insensitive,
 * any doc extension): GitHub renders them, agents read their instruction files
 * from there, package managers ship them.
 */
const ROOT_STEMS = new Set([
  'readme', 'changelog', 'changes', 'history', 'news', 'release_notes', 'releasenotes',
  'license', 'licence', 'copying', 'notice', 'authors', 'contributors', 'maintainers',
  'contributing', 'code_of_conduct', 'security', 'support', 'governance', 'funding',
  'citation', 'codeowners', 'pull_request_template',
  'agents', 'agent', 'claude', 'claude.local', 'gemini', 'qwen', 'conventions', 'copilot-instructions'
])

const stemOf = (name) => basename(name, extname(name)).toLowerCase().replace(/-/g, '_')

/** A doc that belongs in docs/ rather than at the root. */
export function isLooseDocName(name) {
  const ext = extname(name).toLowerCase()
  if (!DOC_EXT.has(ext) || name.startsWith('.')) return false
  return !ROOT_STEMS.has(stemOf(name)) && !ROOT_STEMS.has(stemOf(name).replace(/_/g, '-'))
}

/** `file` would be a loose doc at `project`'s root. */
export function isLooseDocPath(project, file) {
  const abs = resolve(project, file)
  return dirname(abs) === resolve(project) && isLooseDocName(basename(abs))
}

/** The loose docs at a project's root, sorted. */
export function looseDocs(project) {
  let names = []
  try {
    names = readdirSync(project)
  } catch {
    return []
  }
  return names
    .filter((n) => isLooseDocName(n))
    .filter((n) => {
      try {
        return statSync(join(project, n)).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

/** A link target that is a path inside this project, not a URL, anchor or absolute path. */
function isRelativeTarget(t) {
  return Boolean(t) && !/^([a-z][a-z0-9+.-]*:|#|\/|\\|~)/i.test(t)
}

const toPosix = (p) => p.split(sep).join('/')

/**
 * Rewrite the relative link targets in `text`: markdown links and images,
 * reference definitions and html src/href. `map(target)` returns the new
 * target or null to leave it. The `#anchor` and `?query` parts are kept.
 */
function rewriteLinks(text, map) {
  const swap = (target) => {
    const m = /^([^#?]*)([#?].*)?$/.exec(target)
    const path = m ? m[1] : target
    if (!isRelativeTarget(path)) return target
    let decoded = path
    try {
      decoded = decodeURI(path)
    } catch {
      decoded = path
    }
    const next = map(decoded)
    if (next === null) return target
    // Written percent-encoded, kept percent-encoded; written raw, kept raw.
    return (/%[0-9a-f]{2}/i.test(path) ? encodeURI(next) : next) + (m?.[2] ?? '')
  }
  return text
    .replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g, (all, open, target, close) => {
      const bare = target.startsWith('<') ? target.slice(1, -1) : target
      const next = swap(bare)
      return next === bare ? all : `${open}${target.startsWith('<') ? `<${next}>` : next}${close}`
    })
    .replace(/^(\s{0,3}\[[^\]\n]+\]:\s*)(\S+)/gm, (all, open, target) => {
      const next = swap(target)
      return next === target ? all : `${open}${next}`
    })
    .replace(/(\s(?:src|href)=["'])([^"'\n]+)(["'])/g, (all, open, target, close) => {
      const next = swap(target)
      return next === target ? all : `${open}${next}${close}`
    })
}

/** docs/NAME, or docs/NAME-2... when the name is taken by a different file. */
function freeTarget(docsDir, name, source) {
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let n = 1; n < 1000; n += 1) {
    const candidate = join(docsDir, n === 1 ? name : `${stem}-${n}${ext}`)
    if (!existsSync(candidate)) return { path: candidate, duplicate: false }
    try {
      if (readFileSync(candidate).equals(readFileSync(source))) return { path: candidate, duplicate: true }
    } catch {
      /* unreadable: try the next name */
    }
  }
  return null
}

/**
 * Move the loose docs at `project`'s root into docs/, fixing links on the way.
 * Returns what moved: `[{ from, to }]` relative to the project, '' `to` for a
 * root copy that was identical to one already in docs/ and was removed.
 */
export function sweepDocs(project) {
  const root = resolve(project)
  // A project, never a home folder or a drive root someone passed by mistake.
  if (root === resolve(homedir()) || dirname(root) === root) return []
  if (!['.planide', '.git'].some((m) => existsSync(join(root, m)))) return []
  const loose = looseDocs(root)
  if (!loose.length) return []
  const docsDir = join(root, DOCS_DIR)
  mkdirSync(docsDir, { recursive: true })

  // Decide every destination first, so links between moved files resolve to
  // where each one ends up, not where it was.
  const moves = []
  for (const name of loose) {
    const source = join(root, name)
    const target = freeTarget(docsDir, name, source)
    if (target) moves.push({ name, source, ...target })
  }
  const newHome = new Map(moves.map((m) => [m.source, m.path]))
  const relocated = (abs) => newHome.get(abs) ?? abs

  for (const m of moves) {
    if (m.duplicate) {
      rmSync(m.source)
      continue
    }
    if (TEXT_EXT.has(extname(m.name).toLowerCase())) {
      // Relative to the root it was written for -> relative to docs/.
      const text = readFileSync(m.source, 'utf8')
      const fixed = rewriteLinks(text, (t) => {
        const abs = resolve(root, t)
        if (!existsSync(abs) && !newHome.has(abs)) return null
        const rel = toPosix(relative(dirname(m.path), relocated(abs)))
        return rel || posix.basename(t)
      })
      writeFileSync(m.path, fixed)
      rmSync(m.source)
    } else {
      renameSync(m.source, m.path)
    }
  }

  // Whatever still points at the old places: the root docs that stay, and the
  // docs already in docs/.
  const pointers = [
    ...readdirSync(root).filter((n) => TEXT_EXT.has(extname(n).toLowerCase())).map((n) => join(root, n)),
    ...readdirSync(docsDir).filter((n) => TEXT_EXT.has(extname(n).toLowerCase())).map((n) => join(docsDir, n))
  ]
  for (const file of pointers) {
    if (moves.some((m) => m.path === file && !m.duplicate)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const fixed = rewriteLinks(text, (t) => {
      const abs = resolve(dirname(file), t)
      const to = newHome.get(abs)
      return to ? toPosix(relative(dirname(file), to)) : null
    })
    if (fixed !== text) writeFileSync(file, fixed)
  }

  return moves.map((m) => ({
    from: m.name,
    to: m.duplicate ? '' : toPosix(relative(root, m.path))
  }))
}

/** One line for an agent or the activity log about what a sweep did; '' when nothing moved. */
export function sweepNote(moved) {
  if (!moved?.length) return ''
  const list = moved
    .slice(0, 6)
    .map((m) => (m.to ? `${m.from} -> ${m.to}` : `${m.from} (same as the copy in docs/)`))
    .join(', ')
  return (
    `PulsarIDE moved ${moved.length} loose doc(s) into ${DOCS_DIR}/: ${list}${moved.length > 6 ? ', ...' : ''}. ` +
    `Docs live in ${DOCS_DIR}/ -- work on them there, not at the root.`
  )
}

/** The documents directly in docs/ that are not yet in the bundle. */
function unbundled(project) {
  const docsDir = join(project, DOCS_DIR)
  let names = []
  try {
    names = readdirSync(docsDir)
  } catch {
    return []
  }
  return names.filter((n) => {
    if (n.toLowerCase() === BUNDLE_FILE.toLowerCase() || !DOC_EXT.has(extname(n).toLowerCase())) return false
    try {
      return statSync(join(docsDir, n)).isFile()
    } catch {
      return false
    }
  })
}

/**
 * A finished project with its knowledge spread over several documents: more
 * than one doc in docs/, or any next to an existing bundle (new work since it
 * was written). Returns the docs to fold in, or [].
 */
export function docsNeedBundling(project) {
  const loose = unbundled(project)
  const hasBundle = existsSync(join(project, DOCS_DIR, BUNDLE_FILE))
  return loose.length > 1 || (hasBundle && loose.length > 0) ? loose.sort() : []
}

/** What the bundle item asks for, in its notes -- the agent reads it from the board. */
export function bundleNotes(docs) {
  return (
    `The board is clear, so the project's docs become one document. Read every file in ${DOCS_DIR}/ ` +
    `(${docs.slice(0, 12).join(', ')}${docs.length > 12 ? ', ...' : ''}) and the code where they disagree, then write ` +
    `${DOCS_DIR}/${BUNDLE_FILE}: what the project is, how to run and test it, how it is built, the decisions and ` +
    'why, and where it stands -- current facts only, no history of how it got there. Keep the existing ' +
    `${BUNDLE_FILE} and fold the new docs into it. Then move the source docs into ${DOCS_DIR}/archive/ so ` +
    `${DOCS_DIR}/ holds the one document.`
  )
}
