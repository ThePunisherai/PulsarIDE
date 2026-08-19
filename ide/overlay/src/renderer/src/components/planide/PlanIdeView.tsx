/**
 * PlanIDE — the full tracker, as a top-level page in the IDE.
 *
 * The right-sidebar panel is the glanceable version you keep open while an agent
 * works. This is the workbench: quick capture, the whole board, what must not
 * break, the fix log, roadmap, versions, and the activity trail — everything the
 * standalone tracker UI has, without leaving the IDE.
 *
 * All state lives in the tracker engine (the same state the CLI and MCP server
 * write), reached through the preload bridge. Nothing is duplicated here.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Flag,
  History,
  Loader2,
  Lock,
  Map as MapIcon,
  Plus,
  RefreshCw,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorktree } from '@/store/selectors'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  addItem,
  addMilestone,
  aiReport,
  deleteItem,
  ensureProjectForPath,
  getProject,
  lockItem,
  markFixDone,
  setItemStatus,
  toggleMilestone,
  updateItem,
  verifyItem,
  type PlanIdeItem,
  type PlanIdeProject
} from '../right-sidebar/planide-engine-client'

type Tab = 'board' | 'protected' | 'fixes' | 'roadmap' | 'versions' | 'activity' | 'ai'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'board', label: 'Board', icon: Radar },
  { id: 'protected', label: 'Protected', icon: Lock },
  { id: 'fixes', label: 'Fixes', icon: Wrench },
  { id: 'roadmap', label: 'Roadmap', icon: MapIcon },
  { id: 'versions', label: 'Versions', icon: Tag },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'ai', label: 'AI briefing', icon: Sparkles }
]

/** Columns in board order: problems first, finished work last. */
const COLUMNS: { id: PlanIdeItem['status']; label: string; dot: string }[] = [
  { id: 'broken', label: 'Broken', dot: 'bg-rose-500' },
  { id: 'blocked', label: 'Blocked', dot: 'bg-amber-500' },
  { id: 'wip', label: 'In progress', dot: 'bg-violet-400' },
  { id: 'todo', label: 'To do', dot: 'bg-muted-foreground' },
  { id: 'works', label: 'Works', dot: 'bg-emerald-500' },
  { id: 'done', label: 'Complete', dot: 'bg-violet-500' }
]

const NEXT_STATUS: Record<PlanIdeItem['status'], PlanIdeItem['status']> = {
  todo: 'wip',
  wip: 'works',
  works: 'done',
  done: 'broken',
  broken: 'blocked',
  blocked: 'todo'
}

// --------------------------------------------------------------------------- bits
function Stat({
  label,
  value,
  tone,
  hint
}: {
  label: string
  value: number | string
  tone?: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums', tone)}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Badges describe what the item IS; the buttons below say what clicking DOES. */
function ItemBadges({ item }: { item: PlanIdeItem }): React.JSX.Element | null {
  const bits: React.JSX.Element[] = []
  if (item.locked)
    bits.push(
      <span
        key="l"
        className="inline-flex items-center gap-1 rounded-full bg-violet-400/15 px-1.5 py-px text-[9px] font-bold tracking-wide text-violet-400"
      >
        <Lock size={8} /> PROTECTED
      </span>
    )
  if (item.verified)
    bits.push(
      <span
        key="v"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-bold tracking-wide text-emerald-500"
      >
        <ShieldCheck size={8} /> CONFIRMED
      </span>
    )
  else if (item.claimed_by && (item.status === 'works' || item.status === 'done'))
    bits.push(
      <span
        key="c"
        className="rounded-full bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold text-amber-500"
      >
        claimed · {item.claimed_by}
      </span>
    )
  if (item.priority && item.priority !== 'normal')
    bits.push(
      <span key="p" className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">
        {item.priority}
      </span>
    )
  return bits.length ? <div className="mt-1.5 flex flex-wrap gap-1">{bits}</div> : null
}

function ItemCard({
  item,
  onCycle,
  onVerify,
  onLock,
  onEdit,
  onDelete
}: {
  item: PlanIdeItem
  onCycle: (i: PlanIdeItem) => void
  onVerify: (i: PlanIdeItem) => void
  onLock: (i: PlanIdeItem) => void
  onEdit: (i: PlanIdeItem) => void
  onDelete: (i: PlanIdeItem) => void
}): React.JSX.Element {
  const working = item.status === 'works' || item.status === 'done'
  const regressed = item.locked && (item.status === 'broken' || item.status === 'blocked')
  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card px-3 py-2.5 transition-colors',
        regressed
          ? 'border-rose-500/60'
          : item.locked
            ? 'border-violet-400/45'
            : 'border-border hover:border-ring'
      )}
    >
      {item.locked && (
        <span
          className={cn(
            'absolute inset-y-2 left-0 w-[2px] rounded-full',
            regressed ? 'bg-rose-500' : 'bg-violet-400'
          )}
        />
      )}
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onCycle(item)}
          className="mt-1 shrink-0 transition-transform hover:scale-125"
          title={translate('planide.view.cycle', 'Change status')}
        >
          <span
            className={cn(
              'block size-2 rounded-full',
              COLUMNS.find((c) => c.id === item.status)?.dot ?? 'bg-muted-foreground'
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="text-[13px] leading-snug">{item.title}</div>
          {item.notes && (
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {item.notes}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50 hover:!text-rose-500"
          title={translate('planide.view.delete', 'Delete')}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <ItemBadges item={item} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {working && (
          <button
            type="button"
            onClick={() => onVerify(item)}
            className={cn(
              'rounded border px-2 py-0.5 text-[10px] transition-colors',
              item.verified
                ? 'border-emerald-500/40 text-emerald-500'
                : 'border-border text-muted-foreground hover:border-emerald-500 hover:text-emerald-500'
            )}
            title={translate('planide.view.confirmHint', 'Only you can confirm — an agent saying "works" is a claim')}
          >
            {item.verified
              ? translate('planide.view.undoConfirm', 'undo confirm')
              : translate('planide.view.confirm', 'confirm')}
          </button>
        )}
        <button
          type="button"
          onClick={() => onLock(item)}
          className={cn(
            'rounded border px-2 py-0.5 text-[10px] transition-colors',
            item.locked
              ? 'border-violet-400/40 text-violet-400'
              : 'border-border text-muted-foreground hover:border-violet-400 hover:text-violet-400'
          )}
          title={translate('planide.view.protectHint', 'Agents are told protected work is off-limits')}
        >
          {item.locked
            ? translate('planide.view.unprotect', 'unprotect')
            : translate('planide.view.protect', 'protect')}
        </button>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- page
export default function PlanIdeView(): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const worktreePath = activeWorktree?.path ?? null

  const [project, setProject] = useState<PlanIdeProject | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('board')
  const [filter, setFilter] = useState('')
  const [briefing, setBriefing] = useState('')

  // quick capture
  const [qTitle, setQTitle] = useState('')
  const [qNotes, setQNotes] = useState('')
  const [qStatus, setQStatus] = useState<PlanIdeItem['status']>('todo')
  const [qLock, setQLock] = useState(false)
  const [qConfirm, setQConfirm] = useState(false)

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      setProject(await ensureProjectForPath(path))
    } catch (err) {
      setProject(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

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
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [project])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [refresh]
  )

  const quickAdd = useCallback(async () => {
    if (!project || !qTitle.trim()) return
    try {
      const itemId = await addItem(project.id, qTitle.trim(), qStatus, qNotes.trim())
      // Flags go through their own endpoints on purpose: the generic add/update
      // path deliberately cannot set them.
      if (qLock) await lockItem(project.id, itemId, true)
      if (qConfirm) await verifyItem(project.id, itemId, true)
      setQTitle('')
      setQNotes('')
      setQLock(false)
      setQConfirm(false)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [project, qTitle, qNotes, qStatus, qLock, qConfirm, refresh])

  const editItem = useCallback(
    async (item: PlanIdeItem) => {
      const title = window.prompt(translate('planide.view.editTitle', 'Title'), item.title)
      if (title === null) return
      const notes = window.prompt(translate('planide.view.editNotes', 'Notes'), item.notes ?? '')
      if (notes === null) return
      await act(() => updateItem(project!.id, item.id, { title, notes }))
    },
    [act, project]
  )

  useEffect(() => {
    if (tab !== 'ai' || !project) return
    let cancelled = false
    void aiReport(project.id, 'full')
      .then((md) => !cancelled && setBriefing(md))
      .catch((err) => !cancelled && setBriefing(String(err)))
    return () => {
      cancelled = true
    }
  }, [tab, project])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const items = project?.items ?? []
    if (!q) return items
    return items.filter((i) =>
      `${i.title} ${i.notes ?? ''} ${(i.tags ?? []).join(' ')}`.toLowerCase().includes(q)
    )
  }, [project, filter])

  const protectedItems = useMemo(() => (project?.items ?? []).filter((i) => i.locked), [project])
  const regressed = useMemo(
    () => protectedItems.filter((i) => i.status === 'broken' || i.status === 'blocked'),
    [protectedItems]
  )
  const openFixes = useMemo(
    () => (project?.fixes ?? []).filter((f) => f.status === 'open'),
    [project]
  )

  if (!worktreePath) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
        {translate('planide.view.noWorkspace', 'Open a workspace to track it.')}
      </div>
    )
  }
  if (loading && !project) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" size={16} />
        {translate('planide.view.loading', 'Reading tracker…')}
      </div>
    )
  }
  if (error && !project) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <AlertTriangle className="text-amber-500" size={22} />
        <div className="text-sm text-muted-foreground">
          {translate('planide.view.engineDown', 'The PlanIDE tracker engine is not reachable.')}
        </div>
        <div className="max-w-md font-mono text-[11px] break-all text-muted-foreground/70">
          {error}
        </div>
        <Button size="sm" variant="outline" onClick={() => void load(worktreePath)}>
          <RefreshCw size={13} /> {translate('planide.view.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  if (!project) return <div className="flex-1" />

  const p = project.progress
  const langs = project.stack?.detected?.languages ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-5">
        {/* identity + numbers */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Radar className="text-rose-500" size={19} />
              <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {[project.type, `v${project.version}`, ...langs.slice(0, 3)].map((chip) => (
                <span
                  key={chip}
                  className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
              {project.path}
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw size={13} /> {translate('planide.view.refresh', 'Refresh')}
          </Button>
        </div>

        {/* Two truths, never merged: what you confirmed vs what was claimed. */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-emerald-500">
              {p.confirmed}/{p.total_items}{' '}
              {translate('planide.view.confirmedByYou', 'confirmed by you')}
            </span>
            <span className="font-mono text-emerald-500">{p.confirmed_percent}%</span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-amber-500/35"
              style={{ width: `${p.percent}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${p.confirmed_percent}%` }}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Confirmed" value={p.confirmed} tone="text-emerald-500" />
          <Stat
            label="Claimed"
            value={p.unconfirmed}
            tone={p.unconfirmed ? 'text-amber-500' : undefined}
            hint={p.unconfirmed ? 'unchecked' : undefined}
          />
          <Stat label="Complete" value={p.complete} />
          <Stat label="Still open" value={p.open} />
          <Stat
            label="Protected"
            value={p.protected}
            tone={p.regressed ? 'text-rose-500' : 'text-violet-400'}
          />
          <Stat
            label="Broken"
            value={p.broken}
            tone={p.broken ? 'text-rose-500' : undefined}
          />
        </div>

        {regressed.length > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3.5 py-3">
            <ShieldAlert className="mt-0.5 shrink-0 text-rose-500" size={16} />
            <div className="min-w-0 text-[12px]">
              <div className="font-semibold text-rose-500">
                {regressed.length}{' '}
                {translate('planide.view.regression', 'protected item(s) broke')}
              </div>
              <div className="text-muted-foreground">
                {translate('planide.view.regressionHint', 'You marked these “do not break”:')}{' '}
                {regressed.map((i) => i.title).join(', ')}.{' '}
                {translate('planide.view.regressionFirst', 'Fix before anything else.')}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto shrink-0"
              onClick={() => setTab('protected')}
            >
              {translate('planide.view.open', 'Open')}
            </Button>
          </div>
        )}

        {/* quick capture — your own board, fast */}
        <div className="mt-4 rounded-lg border border-violet-400/30 bg-card/40 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {translate('planide.view.addWhatYouKnow', 'Add what you know')}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={qTitle}
              onChange={(e) => setQTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
              placeholder={translate('planide.view.qTitle', 'e.g. save button throws a 500')}
              className="min-w-[220px] flex-[2] rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-ring"
            />
            <select
              value={qStatus}
              onChange={(e) => setQStatus(e.target.value as PlanIdeItem['status'])}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-[13px] outline-none focus:border-ring"
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => void quickAdd()}>
              <Plus size={13} /> {translate('planide.view.add', 'Add')}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              value={qNotes}
              onChange={(e) => setQNotes(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
              placeholder={translate('planide.view.qNotes', 'details (optional) — what exactly happens?')}
              className="min-w-[220px] flex-[2] rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-ring"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={qLock} onChange={(e) => setQLock(e.target.checked)} />
              {translate('planide.view.qLock', 'protect (do not break)')}
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={qConfirm}
                onChange={(e) => setQConfirm(e.target.checked)}
              />
              {translate('planide.view.qConfirm', 'I confirmed this works')}
            </label>
          </div>
        </div>

        {/* tabs */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
          {TABS.map((t) => {
            const Icon = t.icon
            const badge =
              t.id === 'protected' ? protectedItems.length : t.id === 'fixes' ? openFixes.length : 0
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                  tab === t.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <Icon size={13} />
                {t.label}
                {badge > 0 && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
          {tab === 'board' && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={translate('planide.view.filter', 'filter…')}
              className="ml-auto w-40 rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none focus:border-ring"
            />
          )}
        </div>

        <div className="py-4">
          {tab === 'board' && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLUMNS.map((col) => {
                const items = shown.filter((i) => i.status === col.id)
                return (
                  <div key={col.id} className="rounded-lg border border-border/60 bg-background/40 p-2.5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className={cn('size-1.5 rounded-full', col.dot)} />
                      {col.label}
                      <span className="ml-auto tabular-nums">{items.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {items.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          onCycle={(i) => void act(() => setItemStatus(project.id, i.id, NEXT_STATUS[i.status]))}
                          onVerify={(i) => void act(() => verifyItem(project.id, i.id, !i.verified))}
                          onLock={(i) => void act(() => lockItem(project.id, i.id, !i.locked))}
                          onEdit={(i) => void editItem(i)}
                          onDelete={(i) => {
                            if (window.confirm(translate('planide.view.confirmDelete', 'Delete this item?')))
                              void act(() => deleteItem(project.id, i.id))
                          }}
                        />
                      ))}
                      {items.length === 0 && (
                        <div className="py-2 text-center text-[11px] text-muted-foreground/50">—</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'protected' && (
            <div className="flex flex-col gap-4">
              {regressed.length > 0 && (
                <div className="rounded-lg border border-rose-500/50 bg-rose-500/5 p-3.5">
                  <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-rose-500">
                    <ShieldAlert size={15} />
                    {translate('planide.view.regressionTitle', 'Regression — protected work is broken')}
                  </div>
                  <div className="mb-3 text-[12px] text-muted-foreground">
                    {translate('planide.view.regressionBody', 'You marked these “do not break”. They are failing now. This is the first thing to fix.')}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {regressed.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        onCycle={(i) => void act(() => setItemStatus(project.id, i.id, NEXT_STATUS[i.status]))}
                        onVerify={(i) => void act(() => verifyItem(project.id, i.id, !i.verified))}
                        onLock={(i) => void act(() => lockItem(project.id, i.id, !i.locked))}
                        onEdit={(i) => void editItem(i)}
                        onDelete={(i) => void act(() => deleteItem(project.id, i.id))}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 text-[13px] font-semibold">
                  {translate('planide.view.protectedTitle', 'Protected — do not break')}
                </div>
                <div className="mb-3 text-[12px] text-muted-foreground">
                  {translate('planide.view.protectedBody', 'Agents see this list in every briefing, and are told not to refactor or “improve” these while doing something else.')}
                </div>
                {protectedItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
                    {translate('planide.view.protectedEmpty', 'Nothing protected yet. Mark the things that already work and must stay working.')}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {protectedItems
                      .filter((i) => !regressed.includes(i))
                      .map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          onCycle={(i) => void act(() => setItemStatus(project.id, i.id, NEXT_STATUS[i.status]))}
                          onVerify={(i) => void act(() => verifyItem(project.id, i.id, !i.verified))}
                          onLock={(i) => void act(() => lockItem(project.id, i.id, !i.locked))}
                          onEdit={(i) => void editItem(i)}
                          onDelete={(i) => void act(() => deleteItem(project.id, i.id))}
                        />
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'fixes' && (
            <div className="flex flex-col gap-1">
              {(project.fixes ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
                  {translate('planide.view.noFixes', 'No fixes logged yet.')}
                </div>
              )}
              {(project.fixes ?? []).map((f) => (
                <div
                  key={f.id}
                  className="flex items-start gap-3 border-b border-border/60 py-2.5 last:border-none"
                >
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 rounded-full px-2 py-px text-[10px] font-bold',
                      f.status === 'open'
                        ? 'bg-amber-500/15 text-amber-500'
                        : f.status === 'fixed'
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {f.status}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">{f.title}</div>
                    {f.problem && (
                      <div className="text-[11px] text-muted-foreground">
                        <b>problem:</b> {f.problem}
                      </div>
                    )}
                    {f.solution && (
                      <div className="text-[11px] text-muted-foreground">
                        <b>solution:</b> {f.solution}
                      </div>
                    )}
                    {f.agent && (
                      <div className="text-[10px] text-violet-400">agent: {f.agent}</div>
                    )}
                  </div>
                  {f.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => void act(() => markFixDone(project.id, f.id))}
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-emerald-500 hover:text-emerald-500"
                    >
                      <Check size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'roadmap' && (
            <div className="flex flex-col gap-1">
              <div className="mb-2 text-[12px] text-muted-foreground">
                {p.milestones_done}/{p.milestones_total}{' '}
                {translate('planide.view.milestonesDone', 'milestones done')}
              </div>
              {(project.roadmap ?? []).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-none"
                >
                  <button
                    type="button"
                    onClick={() => void act(() => toggleMilestone(project.id, m.id, !m.done))}
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded border transition-colors',
                      m.done
                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-500'
                        : 'border-border text-transparent hover:border-emerald-500'
                    )}
                  >
                    <Check size={11} />
                  </button>
                  <div className="min-w-0 flex-1 text-[13px]">{m.title}</div>
                  {m.target && (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {m.target}
                    </span>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const title = window.prompt(translate('planide.view.newMilestone', 'Milestone'))
                  if (!title) return
                  const target =
                    window.prompt(translate('planide.view.milestoneTarget', 'Target (optional)')) ?? ''
                  void act(() => addMilestone(project.id, title, target))
                }}
                className="mt-2 flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:border-ring hover:text-foreground"
              >
                <Flag size={12} /> {translate('planide.view.addMilestone', 'Add milestone')}
              </button>
            </div>
          )}

          {tab === 'versions' && (
            <div className="flex flex-col gap-4">
              {(project.versions ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
                  {translate('planide.view.noVersions', 'No versions cut yet.')}
                </div>
              )}
              {(project.versions ?? []).map((v) => (
                <div key={v.version} className="border-l-2 border-border pl-4">
                  <div className="font-mono text-[13px] font-semibold">v{v.version}</div>
                  <div className="text-[10px] text-muted-foreground">{v.date}</div>
                  {v.notes && <div className="mt-1 text-[12px]">{v.notes}</div>}
                  {[
                    { k: 'added', tone: 'text-emerald-500', sign: '+' },
                    { k: 'fixed', tone: 'text-violet-400', sign: '✓' },
                    { k: 'changed', tone: 'text-amber-500', sign: '~' }
                  ].map(({ k, tone, sign }) =>
                    ((v as unknown as Record<string, string[]>)[k] ?? []).map((line) => (
                      <div key={`${k}-${line}`} className="mt-0.5 text-[11px]">
                        <span className={tone}>{sign}</span> {line}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'activity' && (
            <div className="flex flex-col">
              {(project.activity ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
                  {translate('planide.view.noActivity', 'Nothing recorded yet.')}
                </div>
              )}
              {(project.activity ?? []).map((a) => (
                <div
                  key={a.id}
                  className="flex items-baseline gap-3 border-b border-border/50 py-1.5 text-[12px] last:border-none"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-px text-[10px] font-bold',
                      a.who === 'you'
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-violet-400/15 text-violet-400'
                    )}
                  >
                    {a.who}
                  </span>
                  <span className="min-w-0 flex-1">{a.text}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {String(a.at).slice(5, 16).replace('T', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === 'ai' && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] text-muted-foreground">
                  {translate('planide.view.aiHint', 'Hand this to any agent — it leads with what must not break.')}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    void navigator.clipboard.writeText(briefing)
                    toast.success(translate('planide.view.copied', 'Copied'))
                  }}
                >
                  <ClipboardCopy size={13} /> {translate('planide.view.copy', 'Copy')}
                </Button>
              </div>
              <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-card/40 p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
                {briefing || translate('planide.view.generating', 'Generating…')}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
