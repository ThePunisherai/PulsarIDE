/**
 * Per-project memory status: is graphify's knowledge graph built for this
 * project, and does its Obsidian note exist yet?
 *
 * This is the read side of the memory the SessionStart hook
 * (graphify-bootstrap) and the tracker's memory-sync write. The IDE's Tracker
 * tab shows it as a small "Project memory" panel, so a user can *see* graphify
 * and Obsidian actually working for the project in front of them — the "overview
 * of how graphify works, per project" that was asked for — instead of trusting
 * that a background hook ran.
 *
 * Pure Node fs, best-effort: every read is wrapped, and a missing graph, vault
 * or note is a normal "not yet" state, never an error. It never writes anything.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join } from 'node:path'

export type MemoryStatus = {
  graphify: {
    /** graphify-out/graph.json exists for this project. */
    available: boolean
    nodes: number
    edges: number
    /** graph.json mtime, epoch ms, or null. */
    updatedAt: number | null
    hasReport: boolean
    hasHtml: boolean
  }
  obsidian: {
    /** The resolved vault (explicit setting, or auto-detected), or null. */
    vault: string | null
    /** `<vault>/Pulsar/<project-slug>.md` exists. */
    noteExists: boolean
    notePath: string | null
    updatedAt: number | null
  }
}

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
    // utf-8-sig tolerance: strip a leading BOM if present.
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

/** graphify-out/graph.json for a project: node/edge counts + freshness. */
function graphifyStatus(projectPath: string): MemoryStatus['graphify'] {
  const out = join(projectPath, 'graphify-out')
  const graphPath = join(out, 'graph.json')
  const empty = {
    available: false,
    nodes: 0,
    edges: 0,
    updatedAt: null as number | null,
    hasReport: false,
    hasHtml: false
  }
  if (!existsSync(graphPath)) return empty
  const data = readJson(graphPath) as
    | { nodes?: unknown[]; edges?: unknown[]; links?: unknown[] }
    | null
  const nodes = Array.isArray(data?.nodes) ? data!.nodes.length : 0
  // graphify has used both "edges" and "links" across versions — accept either.
  const edges = Array.isArray(data?.edges)
    ? data!.edges.length
    : Array.isArray(data?.links)
      ? data!.links.length
      : 0
  return {
    available: true,
    nodes,
    edges,
    updatedAt: mtimeMs(graphPath),
    hasReport: existsSync(join(out, 'GRAPH_REPORT.md')),
    hasHtml: existsSync(join(out, 'graph.html'))
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
  for (const v of vaults) {
    if (v.path && existsSync(v.path)) return v.path
  }
  return null
}

/** Resolve the vault the same way council-memory.py does, same priority order. */
function resolveObsidianVault(home: string): string | null {
  const env = process.env.OBSIDIAN_VAULT_PATH
  if (env && existsSync(env)) return env
  for (const brand of ['pulsaride', 'thepunisher']) {
    const settings = readJson(join(home, '.config', brand, 'dashboard-settings.json')) as
      | { obsidian_vault_path?: string }
      | null
    const p = settings?.obsidian_vault_path
    if (p && existsSync(p)) return p
  }
  return detectObsidianVault(home)
}

function obsidianStatus(projectPath: string, home: string): MemoryStatus['obsidian'] {
  const vault = resolveObsidianVault(home)
  if (!vault) return { vault: null, noteExists: false, notePath: null, updatedAt: null }
  const note = join(vault, 'Pulsar', slugify(basename(projectPath)) + '.md')
  const exists = existsSync(note)
  return {
    vault,
    noteExists: exists,
    notePath: exists ? note : null,
    updatedAt: exists ? mtimeMs(note) : null
  }
}

/**
 * The full per-project memory status. `home` is injectable for tests; it
 * defaults to the real home dir.
 */
export function memoryStatus(projectPath: string, home: string = homedir()): MemoryStatus {
  return {
    graphify: graphifyStatus(projectPath),
    obsidian: obsidianStatus(projectPath, home)
  }
}
