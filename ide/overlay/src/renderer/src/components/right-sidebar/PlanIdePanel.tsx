/**
 * PlanIDE panel — the project tracker, native in the right sidebar.
 *
 * Shows the active workspace's board (what works / what's broken), open fixes,
 * and roadmap progress, and lets you flip an item's status without leaving the
 * IDE. State lives in the project's own .planide/state.json, read and written
 * by the main process over IPC — the same file the CLI and the MCP server
 * write, so a fix an agent logs mid-session shows up here on the next refresh.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CircleDot,
  ClipboardCopy,
  ShieldCheck,
  Lock,
  ShieldAlert,
  Plus,
  RefreshCw,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorktree } from '@/store/selectors'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { PlanIdeMark } from '../planide/PlanIdeMark'
import {
  addItem,
  aiReport,
  lockItem,
  markFixDone,
  onBoardChanged,
  openProject,
  setItemStatus,
  verifyItem,
  type ItemStatus,
  type PlanIdeItem,
  type PlanIdeProject,
  withVisibleSpin
} from './planide-engine-client'

const STATUS_ORDER: ItemStatus[] = [
  'broken',
  'blocked',
  'wip',
  'todo',
  'works',
  'done'
]

const STATUS_LABEL: Record<ItemStatus, string> = {
  done: 'Complete',
  works: 'Works',
  wip: 'In progress',
  broken: 'Broken',
  blocked: 'Blocked',
  todo: 'To do'
}

const STATUS_DOT: Record<ItemStatus, string> = {
  done: 'bg-violet-500',
  works: 'bg-emerald-500',
  wip: 'bg-violet-400',
  broken: 'bg-rose-500',
  blocked: 'bg-amber-500',
  todo: 'bg-muted-foreground'
}

/** Cycle order when clicking an item's dot: the states you actually toggle. */
const NEXT_STATUS: Record<ItemStatus, ItemStatus> = {
  todo: 'wip',
  wip: 'works',
  works: 'done',
  done: 'broken',
  broken: 'blocked',
  blocked: 'todo'
}

function StatRow({ project }: { project: PlanIdeProject }): React.JSX.Element {
  const p = project.progress
  return (
    <div className="grid grid-cols-3 gap-2 px-3 pb-3">
      {[
        // Confirmed first: what you have actually seen work is the number that
        // matters. "Claimed" is what agents reported but nobody checked yet.
        { k: 'Confirmed', v: p.confirmed, cls: 'text-emerald-500', dot: 'bg-emerald-500' },
        {
          k: 'Claimed',
          v: p.unconfirmed,
          cls: p.unconfirmed ? 'text-amber-500' : 'text-muted-foreground',
          dot: 'bg-amber-500'
        },
        {
          k: 'Protected',
          v: p.protected,
          cls: p.regressed ? 'text-rose-500' : 'text-violet-400',
          dot: 'bg-violet-400'
        }
      ].map((s) => (
        <div key={s.k} className="rounded-lg border border-border/70 bg-card/40 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <span className={cn('size-1 shrink-0 rounded-full', s.dot)} />
            <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {s.k}
            </span>
          </div>
          <div className={cn('mt-0.5 text-sm font-semibold leading-none tabular-nums', s.cls)}>
            {s.v}
          </div>
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
  const [refreshing, setRefreshing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        // Opening is idempotent, so the active workspace is always attached
        // without a separate "add" step.
        setProject(await openProject(path))
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


  /**
   * `refreshing` is not decoration: without it a refresh that finds nothing new
   * changed nothing on screen at all, so the button read as dead. The icon now
   * spins while it re-reads, which is the whole feedback this control has room
   * for in the sidebar.
   */
  const refresh = useCallback(async () => {
    if (!worktreePath) return
    await withVisibleSpin(setRefreshing, async () => {
      try {
        setProject(await openProject(worktreePath))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }, [worktreePath])

  // Live: an agent writing this project's board updates the panel by itself.
  useEffect(() => {
    if (!worktreePath) return
    return onBoardChanged((changed) => {
      if (changed === worktreePath) void refresh()
    })
  }, [worktreePath, refresh])

  const grouped = useMemo(() => {
    const byStatus = new Map<ItemStatus, PlanIdeItem[]>()
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
      if (!project || !worktreePath) return
      const next = NEXT_STATUS[item.status]
      // Optimistic: the sidebar should feel instant; a failure re-syncs below.
      setProject({
        ...project,
        items: project.items.map((i) => (i.id === item.id ? { ...i, status: next } : i))
      })
      try {
        setProject(await setItemStatus(worktreePath, item.id, next))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
        await refresh()
      }
    },
    [project, worktreePath, refresh]
  )

  const toggleVerified = useCallback(
    async (item: PlanIdeItem) => {
      if (!worktreePath) return
      try {
        setProject(await verifyItem(worktreePath, item.id, !item.verified))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [worktreePath]
  )

  const toggleLocked = useCallback(
    async (item: PlanIdeItem) => {
      if (!worktreePath) return
      try {
        setProject(await lockItem(worktreePath, item.id, !item.locked))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [worktreePath]
  )

  const submitDraft = useCallback(async () => {
    if (!worktreePath || !draft.trim()) return
    try {
      const added = await addItem(worktreePath, { title: draft.trim(), status: 'todo' })
      setProject(added.payload)
      setDraft('')
      setAdding(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [worktreePath, draft])

  const copyBriefing = useCallback(async () => {
    if (!worktreePath) return
    try {
      const md = await aiReport(worktreePath, 'full')
      await navigator.clipboard.writeText(md)
      toast.success(
        translate('planide.panel.briefingCopied', 'AI briefing copied — paste it to an agent')
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [worktreePath])

  if (!worktreePath) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {translate('planide.panel.noWorkspace', 'Open a workspace to track it.')}
      </div>
    )
  }

  if (loading && !project) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{translate('planide.panel.loading', 'Reading tracker…')}</span>
        <div className="pulsar-progress" />
        <div className="pulsar-skeleton h-4 w-32" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="pulsar-skeleton h-12 rounded-lg" />
          ))}
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="pulsar-skeleton h-8 rounded-md" />
        ))}
      </div>
    )
  }

  if (error && !project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertTriangle className="text-amber-500" size={20} />
        <div className="text-xs text-muted-foreground">
          {translate('planide.panel.engineDown', 'The tracker could not read this project.')}
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
          <PlanIdeMark size={15} className="mt-0.5 shrink-0 text-rose-500" strokeWidth={2.25} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">{project.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="rounded-full border border-border/80 px-1.5 py-px text-[10px] text-muted-foreground">
                {project.type}
              </span>
              <span className="rounded-full border border-border/80 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                v{project.version}
              </span>
              {languages.slice(0, 2).map((l) => (
                <span
                  key={l}
                  className="rounded-full border border-border/80 px-1.5 py-px text-[10px] text-muted-foreground"
                >
                  {l}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground"
            aria-label={translate('planide.panel.refresh', 'Refresh tracker')}
          >
            <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          </button>
        </div>

        {/* Two bars on purpose: the solid one is what YOU confirmed, the faint
            one is everything agents merely reported. Collapsing them into a
            single number is how a project looks finished while nobody has
            actually checked anything. */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="text-emerald-500">
              {p.confirmed}/{p.total_items}{' '}
              {translate('planide.panel.confirmed', 'confirmed by you')}
            </span>
            <span className="font-mono text-emerald-500">{p.confirmed_percent}%</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-amber-500/35"
              style={{ width: `${p.percent}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${p.confirmed_percent}%` }}
            />
          </div>
          {p.unconfirmed > 0 && (
            <div className="mt-1 text-[10px] text-amber-500/90">
              {p.unconfirmed}{' '}
              {translate('planide.panel.awaiting', 'reported working, awaiting your check')}
            </div>
          )}
        </div>
      </div>

      {/* The loudest thing this panel can say: work you protected is broken. */}
      {p.regressed > 0 && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-2.5 py-2">
          <ShieldAlert size={13} className="mt-0.5 shrink-0 text-rose-500" />
          <div className="min-w-0 text-[11px]">
            <div className="font-semibold text-rose-500">
              {p.regressed}{' '}
              {translate('planide.panel.regression', 'protected item(s) broke')}
            </div>
            <div className="text-muted-foreground">
              {translate('planide.panel.regressionHint', 'Fix this before anything else.')}
            </div>
          </div>
        </div>
      )}

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
                    setProject(await markFixDone(worktreePath, fix.id))
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
                <div key={item.id} className="group flex items-start gap-2 rounded-md px-1 py-0.5 -mx-1 transition-colors hover:bg-accent/40">
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
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'truncate text-xs',
                          item.status === 'works' && !item.verified && 'text-muted-foreground'
                        )}
                      >
                        {item.title}
                      </span>
                      {item.verified && (
                        <ShieldCheck
                          size={11}
                          className="shrink-0 text-emerald-500"
                          aria-label={translate('planide.panel.confirmedBadge', 'Confirmed by you')}
                        />
                      )}
                      {item.locked && (
                        <Lock
                          size={10}
                          className={cn(
                            'shrink-0',
                            status === 'broken' || status === 'blocked'
                              ? 'text-rose-500'
                              : 'text-violet-400'
                          )}
                          aria-label={translate('planide.panel.protectedBadge', 'Protected: do not break')}
                        />
                      )}
                    </div>
                    {item.notes && (
                      <div className="truncate text-[10px] text-muted-foreground">{item.notes}</div>
                    )}
                    {item.claimed_by && !item.verified && (
                      <div className="text-[10px] text-amber-500/80">
                        {translate('planide.panel.reportedBy', 'reported by')} {item.claimed_by}
                      </div>
                    )}
                  </div>
                  {/* State is always visible (the badges above); the controls
                      appear on hover, matching Orca's own row actions.
                      Only you can protect -- agents have no path to this either. */}
                  <button
                    type="button"
                    onClick={() => void toggleLocked(item)}
                    className={cn(
                      'mt-0.5 shrink-0 rounded border p-0.5 transition-colors',
                      'can-hover:opacity-0 can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100',
                      item.locked
                        ? 'border-violet-400/40 text-violet-400'
                        : 'border-transparent text-muted-foreground/40 hover:border-violet-400 hover:text-violet-400'
                    )}
                    title={
                      item.locked
                        ? translate('planide.panel.unprotect', 'Remove protection')
                        : translate('planide.panel.protect', 'Protect: do not break this')
                    }
                  >
                    <Lock size={10} />
                  </button>
                  {(status === 'works' || status === 'done') && (
                    <button
                      type="button"
                      onClick={() => void toggleVerified(item)}
                      className={cn(
                        'mt-0.5 shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold transition-colors',
                        'can-hover:opacity-0 can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100',
                        item.verified
                          ? 'border-emerald-500/40 text-emerald-500'
                          : 'border-border text-muted-foreground/70 hover:border-emerald-500 hover:text-emerald-500'
                      )}
                      title={
                        item.verified
                          ? translate('planide.panel.unconfirm', 'Withdraw your confirmation')
                          : translate('planide.panel.confirm', 'I checked this — it works')
                      }
                    >
                      {item.verified
                        ? translate('planide.panel.confirmedShort', 'CONFIRMED')
                        : translate('planide.panel.confirmShort', 'CONFIRM')}
                    </button>
                  )}
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
