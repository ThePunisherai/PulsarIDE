/**
 * PlanIDE panel — the project tracker, native in the right sidebar.
 *
 * Shows the active workspace's board (what works / what's broken), open fixes,
 * and roadmap progress, and lets you flip an item's status without leaving the
 * IDE. State is owned by the tracker engine (a loopback Python service started
 * by the main process), which is the same state the CLI and the MCP server
 * write — so a fix an agent logs mid-session shows up here on the next refresh.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CircleDot,
  ClipboardCopy,
  Loader2,
  Plus,
  RefreshCw,
  Radar,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorktree } from '@/store/selectors'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  addItem,
  aiReport,
  ensureProjectForPath,
  getProject,
  markFixDone,
  setItemStatus,
  type PlanIdeItem,
  type PlanIdeProject
} from './planide-engine-client'

const STATUS_ORDER: PlanIdeItem['status'][] = ['broken', 'blocked', 'wip', 'todo', 'works']

const STATUS_LABEL: Record<PlanIdeItem['status'], string> = {
  works: 'Works',
  wip: 'In progress',
  broken: 'Broken',
  blocked: 'Blocked',
  todo: 'To do'
}

const STATUS_DOT: Record<PlanIdeItem['status'], string> = {
  works: 'bg-emerald-500',
  wip: 'bg-violet-400',
  broken: 'bg-rose-500',
  blocked: 'bg-amber-500',
  todo: 'bg-muted-foreground'
}

/** Cycle order when clicking an item's dot: the states you actually toggle. */
const NEXT_STATUS: Record<PlanIdeItem['status'], PlanIdeItem['status']> = {
  todo: 'wip',
  wip: 'works',
  works: 'broken',
  broken: 'blocked',
  blocked: 'todo'
}

function StatRow({ project }: { project: PlanIdeProject }): React.JSX.Element {
  const p = project.progress
  return (
    <div className="grid grid-cols-3 gap-2 px-3 pb-3">
      {[
        { k: 'Working', v: p.done, cls: 'text-emerald-500' },
        { k: 'Broken', v: p.broken, cls: p.broken ? 'text-rose-500' : 'text-muted-foreground' },
        {
          k: 'Open fixes',
          v: p.open_fixes,
          cls: p.open_fixes ? 'text-amber-500' : 'text-muted-foreground'
        }
      ].map((s) => (
        <div key={s.k} className="rounded-md border border-border bg-background/40 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.k}</div>
          <div className={cn('text-sm font-semibold tabular-nums', s.cls)}>{s.v}</div>
        </div>
      ))}
    </div>
  )
}

export default function PlanIdePanel(): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const worktreePath = activeWorktree?.path ?? null

  const [project, setProject] = useState<PlanIdeProject | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        // Registering an already-tracked folder is a server-side no-op, so the
        // active workspace is always attached without a separate "add" step.
        const next = await ensureProjectForPath(path)
        setProject(next)
      } catch (err) {
        setProject(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [setProject]
  )

  useEffect(() => {
    if (!worktreePath) {
      setProject(null)
      return
    }
    void load(worktreePath)
  }, [worktreePath, load])

  const refresh = useCallback(async () => {
    if (!project) return
    try {
      setProject(await getProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [project])

  const grouped = useMemo(() => {
    const byStatus = new Map<PlanIdeItem['status'], PlanIdeItem[]>()
    for (const status of STATUS_ORDER) byStatus.set(status, [])
    for (const item of project?.items ?? []) {
      byStatus.get(item.status)?.push(item)
    }
    return byStatus
  }, [project])

  const openFixes = useMemo(
    () => (project?.fixes ?? []).filter((f) => f.status === 'open'),
    [project]
  )

  const cycleStatus = useCallback(
    async (item: PlanIdeItem) => {
      if (!project) return
      const next = NEXT_STATUS[item.status]
      // Optimistic: the sidebar should feel instant; a failure re-syncs below.
      setProject({
        ...project,
        items: project.items.map((i) => (i.id === item.id ? { ...i, status: next } : i))
      })
      try {
        await setItemStatus(project.id, item.id, next)
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        await refresh()
      }
    },
    [project, refresh]
  )

  const submitDraft = useCallback(async () => {
    if (!project || !draft.trim()) return
    try {
      await addItem(project.id, draft.trim(), 'todo')
      setDraft('')
      setAdding(false)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [project, draft, refresh])

  const copyBriefing = useCallback(async () => {
    if (!project) return
    try {
      const md = await aiReport(project.id, 'full')
      await navigator.clipboard.writeText(md)
      toast.success(
        translate('planide.panel.briefingCopied', 'AI briefing copied — paste it to an agent')
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [project])

  if (!worktreePath) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {translate('planide.panel.noWorkspace', 'Open a workspace to track it.')}
      </div>
    )
  }

  if (loading && !project) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="animate-spin" size={14} />
        {translate('planide.panel.loading', 'Reading tracker…')}
      </div>
    )
  }

  if (error && !project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="text-amber-500" size={20} />
        <div className="text-xs text-muted-foreground">
          {translate('planide.panel.engineDown', 'The PlanIDE tracker engine is not reachable.')}
        </div>
        <div className="font-mono text-[10px] break-all text-muted-foreground/70">{error}</div>
        <Button size="sm" variant="outline" onClick={() => void load(worktreePath)}>
          <RefreshCw size={13} /> {translate('planide.panel.retry', 'Retry')}
        </Button>
      </div>
    )
  }

  if (!project) return <div className="flex-1" />

  const p = project.progress
  const languages = project.stack?.detected?.languages ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-sleek">
      {/* Header: identity + progress */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start gap-2">
          <Radar className="mt-0.5 shrink-0 text-rose-500" size={15} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{project.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                {project.type}
              </span>
              <span className="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                v{project.version}
              </span>
              {languages.slice(0, 2).map((l) => (
                <span
                  key={l}
                  className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground"
                >
                  {l}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
            aria-label={translate('planide.panel.refresh', 'Refresh tracker')}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {p.done}/{p.total_items} {translate('planide.panel.working', 'working')}
            </span>
            <span className="font-mono">{p.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-violet-400 transition-all"
              style={{ width: `${p.percent}%` }}
            />
          </div>
        </div>
      </div>

      <StatRow project={project} />

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={copyBriefing}>
          <ClipboardCopy size={12} /> {translate('planide.panel.copyBriefing', 'AI briefing')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => setAdding((v) => !v)}
          aria-label={translate('planide.panel.addItem', 'Add item')}
        >
          <Plus size={12} />
        </Button>
      </div>

      {adding && (
        <div className="px-3 pb-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitDraft()
              if (e.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
            placeholder={translate('planide.panel.itemPlaceholder', 'What are you tracking?')}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
          />
        </div>
      )}

      {/* Open fixes */}
      {openFixes.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Wrench size={11} /> {translate('planide.panel.openFixes', 'Open fixes')}
            <span className="ml-auto tabular-nums">{openFixes.length}</span>
          </div>
          {openFixes.map((fix) => (
            <div key={fix.id} className="group flex items-start gap-2 py-1">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await markFixDone(project.id, fix.id)
                    await refresh()
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err))
                  }
                }}
                className="mt-0.5 shrink-0 rounded border border-border p-0.5 text-muted-foreground/50 transition-colors hover:border-emerald-500 hover:text-emerald-500"
                aria-label={translate('planide.panel.markFixed', 'Mark fixed')}
              >
                <Check size={10} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{fix.title}</div>
                {fix.agent && (
                  <div className="text-[10px] text-muted-foreground">{fix.agent}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Board */}
      <div className="border-t border-border px-3 py-2">
        {STATUS_ORDER.map((status) => {
          const items = grouped.get(status) ?? []
          if (items.length === 0) return null
          return (
            <div key={status} className="mb-2.5 last:mb-0">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
                {STATUS_LABEL[status]}
                <span className="ml-auto tabular-nums">{items.length}</span>
              </div>
              {items.map((item) => (
                <div key={item.id} className="flex items-start gap-2 py-0.5">
                  <button
                    type="button"
                    onClick={() => void cycleStatus(item)}
                    className="mt-1 shrink-0 transition-transform hover:scale-125"
                    aria-label={translate('planide.panel.cycleStatus', 'Change status')}
                    title={STATUS_LABEL[item.status]}
                  >
                    <span className={cn('block size-2 rounded-full', STATUS_DOT[item.status])} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs">{item.title}</div>
                    {item.notes && (
                      <div className="truncate text-[10px] text-muted-foreground">{item.notes}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
        {(project.items?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CircleDot className="text-muted-foreground/40" size={18} />
            <div className="text-[11px] text-muted-foreground">
              {translate('planide.panel.emptyBoard', 'Nothing tracked yet for this workspace.')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
