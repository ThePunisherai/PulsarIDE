/**
 * Renderer-side client for the PlanIDE tracker engine.
 *
 * Requests go through the preload bridge (`window.api.planide`), which proxies
 * them main-side. Deliberately NOT `fetch` from the renderer: an Electron
 * renderer is a different origin from the engine's loopback port (packaged →
 * `file://`, so `Origin: null`; dev → the Vite origin), so a JSON POST would
 * trigger a CORS preflight and be refused by the engine's CSRF guard. That
 * guard stops arbitrary websites driving the engine and must stay strict, so
 * the IDE goes around it the legitimate way instead of loosening it.
 */

export type PlanIdeProgress = {
  total_items: number
  counts: Record<string, number>
  done: number
  broken: number
  percent: number
  open_fixes: number
  fixed: number
  milestones_total: number
  milestones_done: number
  milestones_percent: number
  health: number
  version: string
}

export type PlanIdeItem = {
  id: string
  title: string
  status: 'todo' | 'wip' | 'works' | 'broken' | 'blocked'
  notes: string
  tags: string[]
  priority: string
}

export type PlanIdeFix = {
  id: string
  title: string
  problem: string
  solution: string
  agent: string
  status: 'open' | 'fixed' | 'wontfix'
}

export type PlanIdeProject = {
  id: string
  name: string
  path: string
  type: string
  version: string
  progress: PlanIdeProgress
  items: PlanIdeItem[]
  fixes: PlanIdeFix[]
  roadmap: { id: string; title: string; target: string; done: boolean }[]
  stack?: { detected?: { languages?: string[]; stack?: string[]; confidence?: string } }
}

type PlanIdeResponse = { ok: boolean; status: number; data: unknown; error?: string }

type PlanIdeBridge = {
  request: (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<PlanIdeResponse>
  port: () => Promise<number | null>
}

/** The preload bridge, or null when running outside the desktop shell. */
function bridge(): PlanIdeBridge | null {
  const api = (globalThis as unknown as { api?: { planide?: PlanIdeBridge } }).api
  return api?.planide ?? null
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const api = bridge()
  if (!api) throw new Error('PlanIDE bridge unavailable (not running in the desktop app)')
  const res = await api.request(method, path, body)
  if (!res.ok) throw new Error(res.error || `${path} -> ${res.status}`)
  return res.data as T
}

/** Port the engine listens on, or null when it never started. */
export async function enginePort(): Promise<number | null> {
  const api = bridge()
  if (!api) return null
  try {
    return await api.port()
  } catch {
    return null
  }
}

/**
 * Make sure `path` is tracked and return its project detail.
 * Registering an already-known folder is a no-op server-side, so this is safe
 * to call every time the active workspace changes.
 */
export async function ensureProjectForPath(path: string): Promise<PlanIdeProject> {
  const added = await call<{ project: { id: string } }>('POST', '/api/project/add', { path })
  return getProject(added.project.id)
}

export async function getProject(id: string): Promise<PlanIdeProject> {
  return call<PlanIdeProject>('GET', `/api/project?id=${encodeURIComponent(id)}`)
}

export async function setItemStatus(
  id: string,
  itemId: string,
  status: PlanIdeItem['status']
): Promise<void> {
  await call('POST', '/api/item/update', { id, item_id: itemId, status })
}

export async function addItem(
  id: string,
  title: string,
  status: PlanIdeItem['status'],
  notes = ''
): Promise<void> {
  await call('POST', '/api/item/add', { id, title, status, notes })
}

export async function markFixDone(id: string, fixId: string): Promise<void> {
  await call('POST', '/api/fix/update', { id, fix_id: fixId, status: 'fixed' })
}

export async function addFix(
  id: string,
  title: string,
  problem: string,
  agent: string
): Promise<void> {
  await call('POST', '/api/fix/add', { id, title, problem, agent, status: 'open' })
}

export async function aiReport(id: string, mode = 'full'): Promise<string> {
  const body = await call<{ markdown: string }>(
    'GET',
    `/api/ai-report?id=${encodeURIComponent(id)}&mode=${encodeURIComponent(mode)}`
  )
  return body.markdown
}
