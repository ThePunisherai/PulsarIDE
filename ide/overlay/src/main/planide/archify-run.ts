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
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
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
