/**
 * PlanIDE tracker bridge (preload).
 *
 * The tracker engine is a loopback HTTP service, but the renderer must NOT talk
 * to it with `fetch`: an Electron renderer is a different origin (file:// in a
 * packaged build → `Origin: null`, http://localhost:<vite> in dev), so a JSON
 * POST would trigger a CORS preflight and be rejected by the engine's CSRF
 * guard. Weakening that guard to allow `null` origins would re-open the exact
 * cross-site hole it exists to close.
 *
 * So requests go main-side over IPC instead, where CORS does not apply — the
 * same named-channel pattern every other Orca feature uses.
 */

import { ipcRenderer } from 'electron'

export type PlanIdeResponse = {
  ok: boolean
  status: number
  data: unknown
  error?: string
}

export const planIdeApi = {
  /** Proxy a tracker-engine request through the main process. */
  request: (method: 'GET' | 'POST', path: string, body?: unknown): Promise<PlanIdeResponse> =>
    ipcRenderer.invoke('planide:request', { method, path, body }),
  /** Port the engine is reachable on, or null when it is not running. */
  port: (): Promise<number | null> => ipcRenderer.invoke('planide:port')
}
