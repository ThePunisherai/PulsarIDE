/**
 * Per-project memory: the knowledge graph (Brain Graph) and the Obsidian notes.
 *
 * This is the read side of what the SessionStart hook and the tracker's
 * memory-sync write. The IDE shows it as two tabs, so you can *see* graphify and
 * Obsidian working for the project in front of you instead of trusting that a
 * background job ran.
 *
 * The graph shape here is not guessed — it was read off a real `graphify extract`
 * run (graphify 0.9.49). The file is node-link JSON:
 *
 *   { directed, multigraph, graph, nodes[], links[], hyperedges[] }
 *   node: id, label, community, file_type, source_file, source_location, _origin
 *   link: source, target, relation, confidence ("EXTRACTED" | "INFERRED" |
 *         "AMBIGUOUS"), confidence_score, context, source_file, weight
 *
 * Note the edge list is `links`, not `edges` — reading the wrong key is exactly
 * the sort of thing that silently reports 0 forever, so both are accepted.
 *
 * Pure Node fs, best-effort: every read is wrapped, and a missing graph, vault or
 * note is a normal "not yet" state, never an error. It never writes anything.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join } from 'node:path'

/** A hub: the nodes most of the graph hangs off ("god nodes" in graphify's own report). */
export type GraphHub = { id: string; label: string; degree: number; file: string }

export type BrainGraph = {
  available: boolean
  nodes: number
  edges: number
  communities: number
  /** Whether `communities` came from graphify's own tags or from our fallback. */
  communitiesFrom: 'graphify' | 'components'
  /** Files graphify has indexed, from its own manifest. */
  indexedFiles: number
  hubs: GraphHub[]
  /** relation -> count, biggest first. */
  relations: { name: string; count: number }[]
  /** EXTRACTED / INFERRED / AMBIGUOUS -> count. */
  confidence: { name: string; count: number }[]
  /** code / doc / paper / image -> count. */
  kinds: { name: string; count: number }[]
  updatedAt: number | null
  hasReport: boolean
  hasHtml: boolean
  /** Set when the graph is too big to analyse without stalling the UI. */
  tooLarge: boolean
  sizeBytes: number
}

export type ObsidianNote = { name: string; path: string; updatedAt: number | null }

export type ObsidianStatus = {
  /** The resolved vault (explicit setting, env, or auto-detected), or null. */
  vault: string | null
  /** How the vault was found, so the UI can say so honestly. */
  source: 'setting' | 'env' | 'detected' | null
  /** `<vault>/Pulse/<project-slug>.md` for THIS project. */
  noteExists: boolean
  notePath: string | null
  updatedAt: number | null
  /** The managed block the agent wrote, for a preview. */
  excerpt: string
  /** Every project note in the vault — what the agent remembers, across projects. */
  notes: ObsidianNote[]
}

export type MemoryStatus = { graphify: BrainGraph; obsidian: ObsidianStatus }

/** Parsing a very large graph on the main process would stall the window. */
const MAX_GRAPH_BYTES = 25 * 1024 * 1024

/** Faithful port of council-memory.py's slug(): the same note filename it writes. */
function slugify(name: string): string {
  const clean = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .toLowerCase()
  return clean || 'project'
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))
  } catch {
    return null
  }
}

function mtimeMs(path: string): number | null {
  try {
    return Math.round(statSync(path).mtimeMs)
  } catch {
    return null
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** count -> sorted [{name, count}], biggest first. */
function tally(values: (string | undefined)[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const key = (v ?? '').trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

const EMPTY_GRAPH: BrainGraph = {
  available: false,
  nodes: 0,
  edges: 0,
  communities: 0,
  communitiesFrom: 'graphify',
  indexedFiles: 0,
  hubs: [],
  relations: [],
  confidence: [],
  kinds: [],
  updatedAt: null,
  hasReport: false,
  hasHtml: false,
  tooLarge: false,
  sizeBytes: 0
}

type RawNode = { id?: unknown; label?: unknown; community?: unknown; file_type?: unknown; source_file?: unknown }
type RawLink = { source?: unknown; target?: unknown; relation?: unknown; confidence?: unknown }

/**
 * Connected components over the edge list -- union-find, near-linear, so it is
 * safe on a graph with thousands of nodes. Nodes with no edges each count as
 * their own component, which is the honest answer: an unconnected file really is
 * its own island in the graph.
 */
function connectedComponents(nodes: RawNode[], links: RawLink[]): number {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) ?? r
    // Path compression, so a long chain does not cost us on the next lookup.
    let cur = x
    while (parent.get(cur) !== r) {
      const next = parent.get(cur) ?? r
      parent.set(cur, r)
      cur = next
    }
    return r
  }
  const add = (id: string): void => {
    if (!parent.has(id)) parent.set(id, id)
  }
  for (const n of nodes) if (typeof n.id === 'string') add(n.id)
  for (const l of links) {
    const a = l.source
    const b = l.target
    if (typeof a !== 'string' || typeof b !== 'string') continue
    add(a)
    add(b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const roots = new Set<string>()
  for (const id of parent.keys()) roots.add(find(id))
  return roots.size
}

/** Read and summarise the project's graphify graph. */
function brainGraph(projectPath: string): BrainGraph {
  const out = join(projectPath, 'graphify-out')
  const graphPath = join(out, 'graph.json')
  if (!existsSync(graphPath)) return EMPTY_GRAPH

  const shell: BrainGraph = {
    ...EMPTY_GRAPH,
    available: true,
    updatedAt: mtimeMs(graphPath),
    hasReport: existsSync(join(out, 'GRAPH_REPORT.md')),
    hasHtml: existsSync(join(out, 'graph.html')),
    sizeBytes: sizeOf(graphPath),
    indexedFiles: Object.keys((readJson(join(out, 'manifest.json')) as object) ?? {}).length
  }
  if (shell.sizeBytes > MAX_GRAPH_BYTES) return { ...shell, tooLarge: true }

  const data = readJson(graphPath) as { nodes?: RawNode[]; links?: RawLink[]; edges?: RawLink[] } | null
  const nodes = Array.isArray(data?.nodes) ? data!.nodes : []
  // graphify writes node-link JSON, so the edge list is `links`; `edges` is
  // accepted too rather than depending on one spelling staying put.
  const links = Array.isArray(data?.links) ? data!.links : Array.isArray(data?.edges) ? data!.edges : []

  // Degree per node -> the hubs. An id that only appears on a link still counts,
  // so a partial graph does not silently lose its busiest connections.
  const degree = new Map<string, number>()
  for (const l of links) {
    for (const end of [l.source, l.target]) {
      if (typeof end !== 'string') continue
      degree.set(end, (degree.get(end) ?? 0) + 1)
    }
  }
  const byId = new Map<string, RawNode>()
  for (const n of nodes) if (typeof n.id === 'string') byId.set(n.id, n)

  const hubs: GraphHub[] = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, deg]) => {
      const n = byId.get(id)
      return {
        id,
        label: typeof n?.label === 'string' && n.label ? n.label : id,
        degree: deg,
        file: typeof n?.source_file === 'string' ? n.source_file : ''
      }
    })

  // graphify tags each node with a numeric `community`. When it is there we use
  // it. When it is NOT -- an older graphify, or a graph written before
  // clustering ran -- reporting 0 clusters for a 2,000-node graph is worse than
  // useless, it reads as broken. So fall back to the connected components of the
  // graph, which is a real structural property we can compute from the edges we
  // already have, and say which of the two the number came from.
  let communities = new Set(
    nodes.map((n) => n.community).filter((c) => c !== undefined && c !== null)
  ).size
  let communitiesFrom: BrainGraph['communitiesFrom'] = 'graphify'
  if (communities === 0 && nodes.length > 0) {
    communities = connectedComponents(nodes, links)
    communitiesFrom = 'components'
  }

  return {
    ...shell,
    nodes: nodes.length,
    edges: links.length,
    communities,
    communitiesFrom,
    hubs,
    relations: tally(links.map((l) => (typeof l.relation === 'string' ? l.relation : undefined))),
    confidence: tally(links.map((l) => (typeof l.confidence === 'string' ? l.confidence : undefined))),
    kinds: tally(nodes.map((n) => (typeof n.file_type === 'string' ? n.file_type : undefined)))
  }
}

/** Per-OS Obsidian auto-detection: most-recently-opened vault that still exists. */
function detectObsidianVault(home: string): string | null {
  let cfg: string | null = null
  if (platform() === 'darwin') {
    cfg = join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')
  } else if (platform() === 'win32') {
    const appdata = process.env.APPDATA
    cfg = appdata ? join(appdata, 'Obsidian', 'obsidian.json') : null
  } else {
    const xdg = process.env.XDG_CONFIG_HOME
    cfg = xdg ? join(xdg, 'obsidian', 'obsidian.json') : join(home, '.config', 'obsidian', 'obsidian.json')
  }
  if (!cfg || !existsSync(cfg)) return null
  const data = readJson(cfg) as { vaults?: Record<string, { path?: string; ts?: number }> } | null
  if (!data || typeof data.vaults !== 'object') return null
  const vaults = Object.values(data.vaults).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  for (const v of vaults) if (v.path && existsSync(v.path)) return v.path
  return null
}

/** Resolve the vault the same way council-memory.py does, same priority order. */
function resolveVault(home: string): { vault: string | null; source: ObsidianStatus['source'] } {
  const env = process.env.OBSIDIAN_VAULT_PATH
  if (env && existsSync(env)) return { vault: env, source: 'env' }
  for (const brand of ['pulsaride', 'thepunisher']) {
    const settings = readJson(join(home, '.config', brand, 'dashboard-settings.json')) as
      | { obsidian_vault_path?: string }
      | null
    const p = settings?.obsidian_vault_path
    if (p && existsSync(p)) return { vault: p, source: 'setting' }
  }
  const detected = detectObsidianVault(home)
  return { vault: detected, source: detected ? 'detected' : null }
}

/** The managed block council-memory.py writes, trimmed for a preview. */
function noteExcerpt(path: string): string {
  try {
    const text = readFileSync(path, 'utf8')
    const body = text.split(/<!--\s*PULSE:BEGIN\s*-->|<!--\s*PULSAR:BEGIN\s*-->/)[1] ?? text
    return body
      .split(/<!--\s*PULSE:END\s*-->|<!--\s*PULSAR:END\s*-->/)[0]
      .trim()
      .slice(0, 600)
  } catch {
    return ''
  }
}

function obsidianStatus(projectPath: string, home: string): ObsidianStatus {
  const { vault, source } = resolveVault(home)
  if (!vault) {
    return { vault: null, source: null, noteExists: false, notePath: null, updatedAt: null, excerpt: '', notes: [] }
  }
  // The agent writes under Pulse/; older installs wrote Pulsar/ or ThePunisher/,
  // so those are still read rather than pretending the earlier notes vanished.
  const folders = ['Pulse', 'Pulsar', 'ThePunisher']
  const slug = slugify(basename(projectPath.replace(/[/\\]+$/, '')))
  let notePath: string | null = null
  const notes: ObsidianNote[] = []
  for (const folder of folders) {
    const dir = join(vault, folder)
    if (!existsSync(dir)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.md'))
    } catch {
      continue
    }
    for (const f of entries) {
      const full = join(dir, f)
      notes.push({ name: f.replace(/\.md$/, ''), path: full, updatedAt: mtimeMs(full) })
      if (!notePath && f === `${slug}.md`) notePath = full
    }
  }
  notes.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return {
    vault,
    source,
    noteExists: Boolean(notePath),
    notePath,
    updatedAt: notePath ? mtimeMs(notePath) : null,
    excerpt: notePath ? noteExcerpt(notePath) : '',
    notes
  }
}

/** The full per-project memory status. `home` is injectable for tests. */
export function memoryStatus(projectPath: string, home: string = homedir()): MemoryStatus {
  return { graphify: brainGraph(projectPath), obsidian: obsidianStatus(projectPath, home) }
}

// --------------------------------------------------------------------------- graph picture

/**
 * A drawable slice of the graph: the busiest nodes and the edges between them.
 *
 * The panel showed counts and bar charts but never a graph, which is the one
 * thing a knowledge graph is for -- reported as "I see no graph". Drawing all
 * of it is not the answer either: a real project here is ~2,000 nodes and
 * ~4,900 edges, which renders as a hairball and costs a second of layout.
 *
 * So this returns the top `limit` nodes by degree and only the edges whose BOTH
 * ends survive that cut. That is the same thing the hub list already claims is
 * important, drawn instead of listed, and it stays honest about being a slice:
 * `shownOf` reports what was kept against the real totals so the panel can say so.
 */
export type GraphPictureNode = {
  id: string
  label: string
  degree: number
  /** code / external / concept / doc ... whatever graphify tagged it. */
  kind: string
}

export type GraphPictureEdge = {
  /** Index into `nodes`, not an id: the renderer draws by position. */
  source: number
  target: number
  relation: string
}

export type GraphPicture = {
  available: boolean
  nodes: GraphPictureNode[]
  edges: GraphPictureEdge[]
  /** How much of the whole graph this slice is. */
  shownOf: { nodes: number; edges: number; totalNodes: number; totalEdges: number }
}

const EMPTY_PICTURE: GraphPicture = {
  available: false,
  nodes: [],
  edges: [],
  shownOf: { nodes: 0, edges: 0, totalNodes: 0, totalEdges: 0 }
}

export function graphPicture(projectPath: string, limit = 60): GraphPicture {
  const graphPath = join(projectPath, 'graphify-out', 'graph.json')
  if (!existsSync(graphPath)) return EMPTY_PICTURE
  if (sizeOf(graphPath) > MAX_GRAPH_BYTES) return EMPTY_PICTURE

  const data = readJson(graphPath) as { nodes?: RawNode[]; links?: RawLink[]; edges?: RawLink[] } | null
  const rawNodes = Array.isArray(data?.nodes) ? data!.nodes : []
  const rawLinks = Array.isArray(data?.links) ? data!.links : Array.isArray(data?.edges) ? data!.edges : []
  if (!rawNodes.length) return EMPTY_PICTURE

  const degree = new Map<string, number>()
  for (const l of rawLinks) {
    for (const end of [l.source, l.target]) {
      if (typeof end === 'string') degree.set(end, (degree.get(end) ?? 0) + 1)
    }
  }

  const byId = new Map<string, RawNode>()
  for (const n of rawNodes) if (typeof n.id === 'string') byId.set(n.id, n)

  const top = [...byId.keys()]
    .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, Math.max(1, limit))
  const index = new Map(top.map((id, i) => [id, i]))

  const nodes: GraphPictureNode[] = top.map((id) => {
    const n = byId.get(id)!
    return {
      id,
      label: typeof n.label === 'string' && n.label ? n.label : id,
      degree: degree.get(id) ?? 0,
      kind: typeof n.file_type === 'string' && n.file_type ? n.file_type : 'code'
    }
  })

  // Only edges wholly inside the slice, and only one line per pair: the picture
  // is about which pieces are connected, not how many times.
  const seen = new Set<string>()
  const edges: GraphPictureEdge[] = []
  for (const l of rawLinks) {
    if (typeof l.source !== 'string' || typeof l.target !== 'string') continue
    const s = index.get(l.source)
    const t = index.get(l.target)
    if (s === undefined || t === undefined || s === t) continue
    const key = s < t ? `${s}-${t}` : `${t}-${s}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ source: s, target: t, relation: typeof l.relation === 'string' ? l.relation : '' })
  }

  return {
    available: true,
    nodes,
    edges,
    shownOf: {
      nodes: nodes.length,
      edges: edges.length,
      totalNodes: rawNodes.length,
      totalEdges: rawLinks.length
    }
  }
}
