/**
 * Actually (re)build the project's knowledge graph, and read back the report
 * graphify writes about it.
 *
 * Why this exists: memory-status.ts only READS `graphify-out/` off disk, so the
 * Brain Graph's Refresh button re-read the same file and showed the same
 * numbers -- indistinguishable from doing nothing, which is exactly how it was
 * reported. Nothing in the IDE ever ran graphify; only the SessionStart hook
 * did, at most once every six hours.
 *
 * Two commands, in this order, both verified against a real graphify 0.9.51:
 *
 *   graphify extract <dir> --code-only    -> graph.json  (no LLM, no API key)
 *   graphify cluster-only <dir> --no-label -> GRAPH_REPORT.md + graph.html
 *
 * `extract` alone does NOT write the report -- graphify's own output says so
 * ("next: run `graphify cluster-only ...` to generate GRAPH_REPORT.md"). That
 * is why hasReport/hasHtml were effectively always false: the second command
 * had never been run by anything we ship.
 *
 * --code-only and --no-label are deliberate: both keep this working with no LLM
 * backend and no API key. Labelling communities needs a model, and a graph that
 * only builds for users who configured one is not a feature you can rely on.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Bounded: a hung indexer must not leave the button spinning forever. */
const EXTRACT_TIMEOUT_MS = 180_000
const CLUSTER_TIMEOUT_MS = 120_000

export type ReindexResult = {
  ok: boolean
  /** graphify's own output, both commands, so a failure is visible verbatim. */
  log: string
  /** Set when graphify itself is missing, which is a normal state, not a fault. */
  missing: boolean
}

function runGraphify(args: string[], cwd: string, timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      'graphify',
      args,
      { cwd, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const out = `${String(stdout ?? '')}${String(stderr ?? '')}`.trim()
        if (error) {
          const code = typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : 1
          resolve({ code, out: out || error.message })
          return
        }
        resolve({ code: 0, out })
      }
    )
  })
}

/**
 * Rebuild the graph for one project. Returns graphify's own words either way --
 * a failure the user can act on beats a silent "nothing happened", which is the
 * whole complaint this fixes.
 */
export async function reindexGraph(projectPath: string): Promise<ReindexResult> {
  if (!projectPath || !existsSync(projectPath)) {
    return { ok: false, missing: false, log: 'No project directory to index.' }
  }
  const extract = await runGraphify(['extract', '.', '--code-only'], projectPath, EXTRACT_TIMEOUT_MS)
  // ENOENT surfaces as a message, not a code we can match on portably.
  if (extract.code !== 0 && /ENOENT|not found|not recognized/i.test(extract.out)) {
    return {
      ok: false,
      missing: true,
      log: 'graphify is not installed. PulsarIDE installs it on first launch; if that was skipped, `pip install graphifyy`.'
    }
  }
  if (extract.code !== 0) return { ok: false, missing: false, log: extract.out }

  // The report and the interactive graph come from this second pass only.
  const cluster = await runGraphify(['cluster-only', '.', '--no-label'], projectPath, CLUSTER_TIMEOUT_MS)
  const log = [extract.out, cluster.out].filter(Boolean).join('\n')
  // A clustering failure still leaves a usable graph.json, so this is not fatal.
  return { ok: true, missing: false, log }
}

export type GraphReportSection = { heading: string; lines: string[] }

/**
 * Split GRAPH_REPORT.md into its `##` sections, in the order graphify wrote
 * them. Deliberately structure-only: the headings are graphify's, not ours, so
 * a new section in a future version shows up on its own instead of being
 * dropped by a parser that only knows the ones that existed today.
 */
export function readGraphReport(projectPath: string): GraphReportSection[] {
  const file = join(projectPath, 'graphify-out', 'GRAPH_REPORT.md')
  if (!existsSync(file)) return []
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const sections: GraphReportSection[] = []
  let current: GraphReportSection | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const h = /^##\s+(.*)$/.exec(line)
    if (h) {
      if (current) sections.push(current)
      current = { heading: h[1].trim(), lines: [] }
      continue
    }
    if (!current) continue
    if (line.trim()) current.lines.push(line)
  }
  if (current) sections.push(current)
  return sections.filter((s) => s.lines.length > 0)
}
