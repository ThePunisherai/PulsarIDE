/**
 * PlanIDE tracker engine — main-process lifecycle.
 *
 * The tracker (board / fixes / roadmap / versions / GitHub sync / backups) is a
 * zero-dependency Python service that lives in `tracker/` and owns all state.
 * The IDE does not re-implement it: this module starts it on a loopback port
 * and the right-sidebar panel talks to it over HTTP.
 *
 * Why a child process instead of a TS port: the engine is already the shipped,
 * self-tested product (it also runs standalone and backs the CLI + MCP server
 * that agents use). One source of truth beats two implementations that drift.
 *
 * Port discovery: the panel cannot read main-process env, so both sides scan the
 * same small range and identify the engine by its own /api/overview response
 * rather than assuming whatever holds the port is ours. See PLANIDE_PORT_RANGE.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, net as electronNet } from 'electron'
import net from 'node:net'

/** Ports both the engine and the panel scan, in order. Keep in sync with the
 *  renderer client (planide-engine-client.ts). */
export const PLANIDE_PORT_RANGE = [8390, 8391, 8392, 8393, 8394]

let child: ChildProcess | null = null
let resolvedPort: number | null = null
let starting: Promise<number | null> | null = null

/** Where the bundled `tracker/` lives, in dev and in a packaged build. */
function resolveTrackerDir(): string | null {
  const candidates = [
    // Packaged: shipped via electron-builder extraResources.
    join(process.resourcesPath ?? '', 'tracker'),
    // Dev: repo root (this file compiles to out/main/**).
    join(app.getAppPath(), 'tracker'),
    join(app.getAppPath(), '..', 'tracker')
  ]
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'server.py'))) return dir
  }
  return null
}

/** The engine needs no third-party packages, just an interpreter. */
function resolvePython(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (open: boolean): void => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(400)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

/** True only when the listener on `port` is genuinely a PlanIDE engine. */
async function isPlanIdeEngine(port: number): Promise<boolean> {
  try {
    const res = await electronNet.fetch(`http://127.0.0.1:${port}/api/overview`)
    if (!res.ok) return false
    const body = (await res.json()) as { version?: unknown; projects?: unknown }
    return typeof body?.version === 'string' && Array.isArray(body?.projects)
  } catch {
    return false
  }
}

/**
 * Start the tracker engine, or adopt one that is already running (standalone
 * `tracker/start.sh`, or a second IDE window).
 *
 * Returns the port it is reachable on, or null when it could not start
 * (no Python / no tracker dir) — the panel then shows how to fix it rather
 * than the IDE failing to boot.
 */
export function startPlanIdeEngine(): Promise<number | null> {
  if (starting) return starting

  starting = (async (): Promise<number | null> => {
    const preferred = Number(process.env.PLANIDE_PORT || 0)
    const ports = preferred
      ? [preferred, ...PLANIDE_PORT_RANGE.filter((p) => p !== preferred)]
      : PLANIDE_PORT_RANGE

    // 1. Adopt an engine that is already up.
    for (const port of ports) {
      if ((await isPortOpen(port)) && (await isPlanIdeEngine(port))) {
        resolvedPort = port
        return port
      }
    }

    const trackerDir = resolveTrackerDir()
    if (!trackerDir) {
      console.warn('[planide] tracker/ not found; the PlanIDE panel will be unavailable')
      return null
    }

    // 2. Spawn on the first port nothing else holds.
    let port: number | null = null
    for (const candidate of ports) {
      if (!(await isPortOpen(candidate))) {
        port = candidate
        break
      }
    }
    if (port === null) {
      console.warn('[planide] no free port in', ports.join(', '))
      return null
    }

    try {
      child = spawn(resolvePython(), [join(trackerDir, 'server.py'), '--no-browser'], {
        cwd: trackerDir,
        // Why: never inherit a TTY the child can block on, and never let the
        // engine open a browser window from inside the IDE.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PLANIDE_PORT: String(port), PLANIDE_OPEN: '0' }
      })
    } catch (err) {
      console.warn('[planide] could not spawn the tracker engine:', err)
      return null
    }

    child.stdout?.on('data', (d) => console.log('[planide]', String(d).trimEnd()))
    child.stderr?.on('data', (d) => console.warn('[planide]', String(d).trimEnd()))
    child.on('exit', (code) => {
      if (code) console.warn('[planide] engine exited with code', code)
      child = null
      resolvedPort = null
      starting = null
    })

    // 3. Wait for it to accept connections (binds fast; cap the wait at ~6s).
    for (let i = 0; i < 40; i++) {
      if (await isPortOpen(port)) {
        resolvedPort = port
        return port
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    console.warn('[planide] engine did not come up on port', port)
    return null
  })()

  return starting
}

/** Port the engine is reachable on, or null if it never started. */
export function getPlanIdeEnginePort(): number | null {
  return resolvedPort
}

/** Only the tracker API is reachable through the bridge. */
function isAllowedEnginePath(path: string): boolean {
  return path.startsWith('/api/') && !path.includes('..')
}

let bridgeRegistered = false

/**
 * Expose the engine to the renderer over IPC.
 *
 * Why not let the renderer fetch the engine directly: an Electron renderer is a
 * different origin (packaged → `file://`, so `Origin: null`; dev → the Vite
 * origin), so a JSON POST would preflight and hit the engine's CSRF guard.
 * Proxying main-side keeps that guard intact — it exists to stop *websites*
 * driving the engine, and this path is not a website.
 */
export function registerPlanIdeBridge(): void {
  if (bridgeRegistered) return
  bridgeRegistered = true

  ipcMain.handle('planide:port', async () => {
    return resolvedPort ?? (await startPlanIdeEngine())
  })

  ipcMain.handle(
    'planide:request',
    async (_event, args: { method?: string; path?: string; body?: unknown }) => {
      const method = args?.method === 'POST' ? 'POST' : 'GET'
      const path = typeof args?.path === 'string' ? args.path : ''
      if (!isAllowedEnginePath(path)) {
        return { ok: false, status: 400, data: null, error: 'blocked path' }
      }
      const port = resolvedPort ?? (await startPlanIdeEngine())
      if (port === null) {
        return { ok: false, status: 503, data: null, error: 'PlanIDE engine is not running' }
      }
      try {
        const res = await electronNet.fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          ...(method === 'POST'
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args?.body ?? {})
              }
            : {})
        })
        const data = await res.json().catch(() => null)
        return {
          ok: res.ok,
          status: res.status,
          data,
          ...(res.ok
            ? {}
            : { error: (data as { error?: string } | null)?.error ?? `HTTP ${res.status}` })
        }
      } catch (err) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )
}

/** Stop the engine we started (an adopted external one is left running). */
export function stopPlanIdeEngine(): void {
  if (child && !child.killed) {
    child.kill()
    child = null
  }
  resolvedPort = null
  starting = null
}
