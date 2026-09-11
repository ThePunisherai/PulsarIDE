/**
 * Archify: the project's diagrams, rendered by the copy the app ships.
 *
 * Archify (tt-a1i/archify, MIT) turns a typed JSON description into a
 * self-contained interactive HTML diagram -- architecture, workflow, sequence,
 * data flow, lifecycle. It declares no runtime dependencies, so it runs on the
 * IDE's own Node with nothing for the user to install, the same trick the
 * tracker MCP server uses.
 *
 * The convention this establishes, and which the agents are told about:
 *
 *   <project>/.planide/diagrams/<name>.<type>.json   the agent writes this
 *   <project>/.planide/diagrams/<name>.<type>.html   archify renders this
 *
 * The type is in the filename because archify's CLI needs it as an argument and
 * a diagram file is meaningless without it. Anything that does not parse as
 * `<name>.<type>.json` with a type archify knows is ignored rather than guessed
 * at -- rendering a sequence diagram as an architecture one produces confident
 * nonsense.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Bounded: a hung render must not leave the panel spinning forever. */
const RENDER_TIMEOUT_MS = 120_000

/** The diagram kinds archify's CLI accepts. Anything else is not a diagram. */
export const ARCHIFY_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'] as const
export type ArchifyType = (typeof ARCHIFY_TYPES)[number]

/**
 * What the tab can show. A diagram type, or `delta` for a Before/Delta/After
 * artifact from `archify compare` -- which has two JSON snapshots as input and
 * one HTML as output, so it never had a source to pair with and was invisible
 * here. Kept out of ARCHIFY_TYPES on purpose: that list is what the CLI accepts
 * as a `render` type, and `delta` is not one.
 */
export type ArchifyArtifactType = ArchifyType | 'delta'

export type ArchifyDiagram = {
  /** Base name without the type or extension, e.g. "checkout-flow". */
  name: string
  type: ArchifyArtifactType
  /** The JSON source, or the artifact itself when it has no separate source. */
  source: string
  /** Absolute path of the rendered HTML, when it has been rendered. */
  html?: string
  /** True when the HTML is older than its source, so it is out of date. */
  stale: boolean
  updatedAt: number
}

export type ArchifyStatus = {
  /** False when the bundled archify is not on disk (a broken/partial deploy). */
  available: boolean
  /** Absolute path of the directory diagrams live in. */
  dir: string
  diagrams: ArchifyDiagram[]
}

/** Where diagrams live for a project. */
export function diagramsDir(projectPath: string): string {
  return join(projectPath, '.planide', 'diagrams')
}

/**
 * The bundled archify entry point, or null when it is not deployed.
 *
 * It ships as a skill (it is one upstream), so it lands wherever skills land.
 * Resolved rather than assumed so a missing deploy reads as "not available"
 * instead of failing on a path that was never there.
 */
export function archifyBin(home: string = homedir()): string | null {
  const bin = join(home, '.claude', 'skills', 'archify', 'bin', 'archify.mjs')
  return existsSync(bin) ? bin : null
}

function parseName(file: string): { name: string; type: ArchifyType } | null {
  const m = /^(.+)\.([a-z]+)\.json$/.exec(file)
  if (!m) return null
  const type = m[2] as ArchifyType
  if (!ARCHIFY_TYPES.includes(type)) return null
  return { name: m[1], type }
}

function isArchifyType(value: string | undefined): value is ArchifyType {
  return typeof value === 'string' && (ARCHIFY_TYPES as readonly string[]).includes(value)
}

/** List a project's diagrams and whether each has been rendered. */
export function archifyStatus(projectPath: string, home: string = homedir()): ArchifyStatus {
  const dir = diagramsDir(projectPath)
  const status: ArchifyStatus = { available: archifyBin(home) !== null, dir, diagrams: [] }
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return status // no diagrams yet is a normal state, not an error
  }
  for (const file of names.sort()) {
    const parsed = parseName(file)
    if (!parsed) continue
    const source = join(dir, file)
    const html = join(dir, file.replace(/\.json$/, '.html'))
    let updatedAt = 0
    let sourceAt = 0
    try {
      sourceAt = statSync(source).mtimeMs
      updatedAt = sourceAt
    } catch {
      continue // vanished between the listing and the stat
    }
    let rendered: string | undefined
    let stale = true
    if (existsSync(html)) {
      rendered = html
      try {
        const htmlAt = statSync(html).mtimeMs
        stale = htmlAt < sourceAt
        updatedAt = Math.max(updatedAt, htmlAt)
      } catch {
        /* unreadable -- treat as needing a re-render */
      }
    }
    status.diagrams.push({ ...parsed, source, html: rendered, stale, updatedAt })
  }

  // Artifacts with no `<name>.<type>.json` beside them.
  //
  // Everything above pairs a source with its render, which is right for a
  // diagram you author and re-render. It silently drops the ones that do not
  // work that way -- `archify compare` takes TWO snapshots and writes ONE
  // Before/Delta/After artifact, so the most useful thing the toolkit produces
  // was the one thing this tab could never show.
  const paired = new Set(status.diagrams.map((d) => (d.html ? basename(d.html) : '')))
  for (const file of names.sort()) {
    if (!file.endsWith('.html') || paired.has(file)) continue
    const html = join(dir, file)
    let updatedAt = 0
    try {
      updatedAt = statSync(html).mtimeMs
    } catch {
      continue
    }
    const base = file.replace(/\.html$/, '')
    const m = /\.([a-z]+)$/.exec(base)
    status.diagrams.push({
      name: base.replace(/\.[a-z]+$/, ''),
      // A delta is its own kind of artifact; anything else keeps its suffix so
      // the tab labels it honestly rather than guessing a diagram type.
      type: isArchifyType(m?.[1]) ? m[1] : 'delta',
      source: html,
      html,
      stale: false,
      updatedAt
    })
  }

  status.diagrams.sort((a, b) => b.updatedAt - a.updatedAt)
  return status
}

export type ArchifyRenderResult = {
  ok: boolean
  /** Absolute path of the rendered HTML, when it worked. */
  html?: string
  /** archify's own output, so a validation failure is visible verbatim. */
  log: string
  /** Set when the bundled archify is missing rather than the render failing. */
  missing: boolean
}

function run(bin: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [bin, ...args],
      {
        cwd,
        timeout: RENDER_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        // The app's own binary is Electron; this makes it a plain Node runtime.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      },
      (error, stdout, stderr) => {
        const out = `${String(stdout ?? '')}${String(stderr ?? '')}`.trim()
        if (error) {
          const code =
            typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1
          resolve({ code, out: out || error.message })
          return
        }
        resolve({ code: 0, out })
      }
    )
  })
}

/**
 * Render one diagram to HTML beside its source.
 *
 * `name` and `type` rather than a path: the caller picks from what
 * archifyStatus listed, so a request can only ever name a diagram that is
 * really there, and no path from the renderer is joined onto disk.
 */
export async function archifyRender(
  projectPath: string,
  name: string,
  type: string,
  home: string = homedir()
): Promise<ArchifyRenderResult> {
  const bin = archifyBin(home)
  if (!bin) {
    return { ok: false, missing: true, log: 'The bundled archify is not deployed yet.' }
  }
  if (!ARCHIFY_TYPES.includes(type as ArchifyType)) {
    return { ok: false, missing: false, log: `Not a diagram type archify knows: ${type}` }
  }
  const dir = diagramsDir(projectPath)
  const source = join(dir, `${name}.${type}.json`)
  if (!existsSync(source)) {
    return { ok: false, missing: false, log: `No such diagram: ${name}.${type}.json` }
  }
  const html = join(dir, `${name}.${type}.html`)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* already there */
  }
  // `--repo-root` is architecture-only. archify rejects the whole render with
  // "--repo-root is currently supported for architecture diagrams only" when it
  // is passed for any other type -- so passing it unconditionally, as this did,
  // meant EVERY dataflow, workflow, sequence and lifecycle diagram failed to
  // render, which is exactly how it was reported ("render niet eens", on a data
  // flow). Architecture still gets it: that is the type that reads the repo.
  const args =
    type === 'architecture'
      ? ['render', type, source, html, '--repo-root', projectPath]
      : ['render', type, source, html]
  const res = await run(bin, args, projectPath)
  if (res.code !== 0 || !existsSync(html)) {
    return { ok: false, missing: false, log: res.out || 'archify render failed' }
  }
  return { ok: true, html, missing: false, log: res.out }
}


// --------------------------------------------------------------------------- baseline

/**
 * Directory-name -> archify component type.
 *
 * A heuristic, and deliberately a shallow one. The schema makes `type`
 * mandatory, so SOME classification has to be chosen; guessing a project's
 * actual architecture from folder names is exactly the judgment this baseline
 * does not claim to have. Names are matched whole, not as substrings, so `lib`
 * does not match `liberty`.
 */
const DIR_TYPE: [names: string[], type: string][] = [
  [['auth', 'authentication', 'security', 'identity'], 'security'],
  [['db', 'database', 'migrations', 'models', 'schema', 'prisma', 'sql', 'entities', 'repositories'], 'database'],
  [['infra', 'infrastructure', 'deploy', 'deployment', 'terraform', 'k8s', 'kubernetes', 'docker', 'ops', 'ci'], 'cloud'],
  [['queue', 'queues', 'events', 'messaging', 'workers', 'jobs'], 'messagebus'],
  [['vendor', 'third_party', 'thirdparty', 'external', 'integrations', 'plugins'], 'external'],
  [['web', 'ui', 'client', 'frontend', 'www', 'pages', 'views', 'renderer', 'public', 'static', 'assets'], 'frontend'],
  [['api', 'server', 'backend', 'services', 'service', 'cmd', 'core', 'internal', 'handlers', 'routes', 'controllers', 'main'], 'backend']
]

/** Never a component: not source, or already skipped everywhere else in the IDE. */
const BASELINE_SKIP = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', 'env', '__pycache__',
  '.mypy_cache', '.pytest_cache', 'target', 'build', 'dist', 'out', 'bin', 'obj',
  '.next', '.nuxt', '.gradle', '.idea', '.vs', '.vscode', 'vendor', 'Pods',
  'DerivedData', '.planide', 'coverage', '.cache', 'cmake-build-debug', '.github',
  'node_modules.bak', '.turbo', '.parcel-cache'
])

/**
 * A diagram is only ever wide enough to read. A repo with forty top-level
 * directories would render as a wall of boxes nobody looks at twice.
 */
const BASELINE_MAX_COMPONENTS = 12

function baselineType(name: string): string {
  const lower = name.toLowerCase()
  for (const [names, type] of DIR_TYPE) if (names.includes(lower)) return type
  // Unknown source directory. `backend` is the least wrong default for code:
  // the alternative types all assert something specific that would be a
  // stronger claim than "this folder holds source".
  return 'backend'
}

/** archify ids are `^[a-zA-Z][a-zA-Z0-9_-]*$`. Directory names are not. */
function baselineId(name: string, taken: Set<string>): string {
  let id = name.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[^a-zA-Z]+/, '')
  if (!id) id = 'dir'
  let out = id
  let n = 2
  while (taken.has(out)) out = `${id}-${n++}`
  taken.add(out)
  return out
}

export type BaselineResult =
  /** A diagram already existed, or the project has nothing worth drawing. */
  | { created: false; reason: 'exists' | 'empty' | 'failed' }
  | { created: true; name: string; type: ArchifyType; path: string }

/**
 * Write a first, factual diagram so the Archify tab is not empty on a project
 * nobody has authored one for.
 *
 * This is the honest half of "create a diagram automatically". What the IDE can
 * do without judgment is state facts it already has: these top-level
 * directories exist, this is the detected stack. What it cannot do is infer how
 * they actually relate -- so this writes NO connections. Drawing arrows between
 * folders would be inventing an architecture and presenting it as read from the
 * code, which is the failure mode this project's own rules exist to prevent.
 * An agent replaces it with a real one; that is what the `archify` skill is for.
 *
 * Never overwrites. It only runs at all when the project has no diagram
 * whatsoever, so an authored set is never joined by a generated stub, and an
 * edited baseline is never reverted underneath the person editing it.
 */
export function ensureBaselineDiagram(
  projectPath: string,
  opts: { title?: string; subtitle?: string } = {}
): BaselineResult {
  const dir = diagramsDir(projectPath)

  // Any existing diagram source means this project is authored. Leave it alone.
  try {
    if (readdirSync(dir).some((f) => parseName(f))) return { created: false, reason: 'exists' }
  } catch {
    /* no diagrams directory yet -- that is the case this function is for */
  }

  let entries: string[]
  try {
    entries = readdirSync(projectPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !BASELINE_SKIP.has(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
  } catch {
    return { created: false, reason: 'failed' }
  }
  if (entries.length === 0) return { created: false, reason: 'empty' }

  const taken = new Set<string>()
  // No `sources`. Verified against the real renderer, not assumed from the
  // schema: attaching a component `sources` entry makes archify demand
  // `meta.repository` -- a pinned PUBLIC GitHub url plus a 40-hex revision
  // ("Repository evidence requires /meta/repository", its own suggested fix
  // being "remove component sources"). A local project need not have a GitHub
  // remote at all, and writing a plausible-looking one to satisfy a validator
  // would be inventing provenance. The directory name is already the label.
  const picked = entries.slice(0, BASELINE_MAX_COMPONENTS)
  const cols = picked.length > 6 ? 4 : 3
  // row/col are explicit. The schema has them optional, but the architecture
  // renderer rejects the whole diagram without them once layout.mode is "grid"
  // ("Component X needs pos [x,y] or grid row/col") -- another thing only a real
  // render surfaces, since the JSON schema alone validates happily.
  const components = picked.map((name, i) => ({
    id: baselineId(name, taken),
    type: baselineType(name),
    label: name,
    sublabel: 'directory',
    row: Math.floor(i / cols),
    col: i % cols
  }))

  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: opts.title || basename(projectPath) || 'Project map',
      subtitle:
        opts.subtitle ||
        'Top-level directories. Generated from the folder layout -- no relationships inferred.',
      legend: { mode: 'auto' }
    },
    layout: { mode: 'grid', cols },
    components
    // No `connections` on purpose -- see the doc comment above.
  }

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'project-map.architecture.json'), JSON.stringify(doc, null, 2) + '\n')
  } catch {
    return { created: false, reason: 'failed' }
  }
  return {
    created: true,
    name: 'project-map',
    type: 'architecture',
    path: join(dir, 'project-map.architecture.json')
  }
}
