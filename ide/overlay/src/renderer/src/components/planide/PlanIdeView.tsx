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

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Check,
  ClipboardCopy,
  Flag,
  GitBranch,
  History,
  Loader2,
  Lock,
  BookText,
  ExternalLink,
  Map as MapIcon,
  Network,
  Plus,
  RefreshCw,
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
import { PlanIdeLogo, PlanIdeMark } from './PlanIdeMark'
// Both talk to the engine on their own and are a tab away, so they load when
// opened rather than on every project.
const PlanIdeSync = lazy(() => import('./PlanIdeSync'))
const PlanIdeBackups = lazy(() => import('./PlanIdeBackups'))
import {
  addFix,
  addItem,
  addMilestone,
  addVersion,
  aiReport,
  deleteItem,
  lockItem,
  markFixDone,
  memoryStatus,
  openProject,
  setItemStatus,
  toggleMilestone,
  updateItem,
  verifyItem,
  type ItemStatus,
  type MemoryStatus,
  type PlanIdeItem,
  type PlanIdeProject
} from '../right-sidebar/planide-engine-client'

type Tab =
  | 'board'
  | 'protected'
  | 'fixes'
  | 'roadmap'
  | 'versions'
  | 'sync'
  | 'backups'
  | 'activity'
  | 'memory'
  | 'ai'

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'board', label: 'Board', icon: PlanIdeMark },
  { id: 'protected', label: 'Protected', icon: Lock },
  { id: 'fixes', label: 'Fixes', icon: Wrench },
  { id: 'roadmap', label: 'Roadmap', icon: MapIcon },
  { id: 'versions', label: 'Versions', icon: Tag },
  { id: 'sync', label: 'GitHub', icon: GitBranch },
  { id: 'backups', label: 'Backups', icon: Archive },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'memory', label: 'Memory', icon: Network },
  { id: 'ai', label: 'AI briefing', icon: Sparkles }
]

/** Columns in board order: problems first, finished work last. */
const COLUMNS: { id: ItemStatus; label: string; dot: string }[] = [
  { id: 'broken', label: 'Broken', dot: 'bg-rose-500' },
  { id: 'blocked', label: 'Blocked', dot: 'bg-amber-500' },
  { id: 'wip', label: 'In progress', dot: 'bg-violet-400' },
  { id: 'todo', label: 'To do', dot: 'bg-muted-foreground' },
  { id: 'works', label: 'Works', dot: 'bg-emerald-500' },
  { id: 'done', label: 'Complete', dot: 'bg-violet-500' }
]

const NEXT_STATUS: Record<ItemStatus, ItemStatus> = {
  todo: 'wip',
  wip: 'works',
  works: 'done',
  done: 'broken',
  broken: 'blocked',
  blocked: 'todo'
}

// --------------------------------------------------------------------------- bits
/**
 * Confirmed vs claimed, as one shape.
 * The outer arc is what an agent reported; the solid inner arc is what you
 * checked yourself. The gap between them is the whole point of this tracker,
 * so it is drawn rather than described.
 */
function ConfirmedRing({
  progress
}: {
  progress: PlanIdeProject['progress']
}): React.JSX.Element {
  const r = 26
  const circumference = 2 * Math.PI * r
  const clamp = (n: number): number => Math.max(0, Math.min(100, n))
  const arc = (pct: number): string => `${(clamp(pct) / 100) * circumference} ${circumference}`
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative size-[68px]">
        <svg viewBox="0 0 68 68" className="size-full -rotate-90">
          <circle cx="34" cy="34" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
          <circle
            cx="34"
            cy="34"
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={arc(progress.percent)}
            className="stroke-amber-500/45"
          />
          <circle
            cx="34"
            cy="34"
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={arc(progress.confirmed_percent)}
            className="stroke-emerald-500 transition-[stroke-dasharray] duration-500"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[15px] font-semibold tabular-nums">
          {progress.confirmed_percent}%
        </span>
      </div>
      <div className="text-[11px] leading-tight">
        <div className="font-medium text-emerald-500">
          {progress.confirmed}/{progress.total_items}{' '}
          {translate('planide.view.confirmedByYou', 'confirmed by you')}
        </div>
        <div className="text-muted-foreground">
          {translate('planide.view.notByAgent', 'checked by you, not claimed by an agent')}
        </div>
        {progress.unconfirmed > 0 && (
          <div className="mt-0.5 text-amber-500">
            +{progress.unconfirmed} {translate('planide.view.claimedUnchecked', 'claimed, unchecked')}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One line of the trail.
 *
 * Everything used to look the same, which made the two lines that matter — a
 * regression, and an agent talking — as quiet as "added an item". The tone and
 * the icon come from the kind, so the list can be skimmed.
 */
type AccountUsage = { account: string; turns: number; lastAt: string }

/**
 * Group agent activity by the AI provider/account that produced it (the `who`
 * on each agent turn — claude / codex / gemini …). This is the multi-account
 * overview: which account did how much work in this project.
 */
function accountsFromActivity(activity: PlanIdeProject['activity']): AccountUsage[] {
  const map = new Map<string, AccountUsage>()
  for (const a of activity ?? []) {
    if (!String(a.kind ?? '').startsWith('agent-')) continue
    const account = (a.who || 'agent').toLowerCase()
    const cur = map.get(account) ?? { account, turns: 0, lastAt: '' }
    cur.turns += 1
    if (String(a.at) > cur.lastAt) cur.lastAt = String(a.at)
    map.set(account, cur)
  }
  return [...map.values()].sort((x, y) => y.turns - x.turns)
}

/** Compact "3m ago" style relative time; empty for a missing/invalid timestamp. */
function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ActivityRow({ entry }: { entry: PlanIdeProject['activity'][number] }): React.JSX.Element {
  const kind = String(entry.kind ?? '')
  const regression = entry.text.includes('REGRESSION')
  const agent = kind.startsWith('agent-')
  const Icon = regression
    ? ShieldAlert
    : agent
      ? PlanIdeMark
      : kind === 'verify'
        ? ShieldCheck
        : kind === 'lock'
          ? Lock
          : kind.startsWith('fix')
            ? Wrench
            : kind === 'version'
              ? Tag
              : Plus
  return (
    <div
      className={cn(
        'flex items-baseline gap-2.5 border-b border-border/40 py-1.5 pl-2 text-[12px] last:border-none',
        regression && 'border-l-2 border-l-rose-500 bg-rose-500/5'
      )}
    >
      <Icon
        size={11}
        className={cn(
          'shrink-0 translate-y-[1px]',
          regression
            ? 'text-rose-500'
            : agent
              ? 'text-violet-400'
              : kind === 'verify'
                ? 'text-emerald-500'
                : 'text-muted-foreground/50'
        )}
      />
      <span
        className={cn(
          'w-[70px] shrink-0 truncate text-[10px] font-semibold',
          entry.who === 'you' ? 'text-emerald-500' : 'text-violet-400'
        )}
      >
        {entry.who}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1',
          regression && 'font-medium text-rose-500',
          kind === 'agent-said' && 'italic text-muted-foreground'
        )}
      >
        {entry.text}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
        {String(entry.at).slice(5, 16).replace('T', ' ')}
      </span>
    </div>
  )
}

/** relTime for an epoch-ms timestamp (memory-status uses file mtimes, not ISO). */
function relTimeMs(ms: number | null): string {
  return ms ? relTime(new Date(ms).toISOString()) : ''
}

/**
 * Per-project memory panel: shows graphify's knowledge graph and the Obsidian
 * note actually working for this project — the "see graphify/Obsidian per
 * project" overview. Read-only; the SessionStart hook and the tracker's
 * memory-sync are what write them.
 */
function MemoryPanel({
  status,
  loading,
  onRefresh
}: {
  status: MemoryStatus | null
  loading: boolean
  onRefresh: () => void
}): React.JSX.Element {
  const g = status?.graphify
  const o = status?.obsidian
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted-foreground">
          {translate(
            'planide.memory.hint',
            'graphify and Obsidian run automatically per project — this is their live state here.'
          )}
        </span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />{' '}
          {translate('planide.memory.refresh', 'Refresh')}
        </Button>
      </div>

      {/* graphify knowledge graph */}
      <div className="rounded-xl border border-border bg-card/40 p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <Network size={15} className={cn(g?.available ? 'text-violet-400' : 'text-muted-foreground/50')} />
          <span className="text-[12.5px] font-semibold">
            {translate('planide.memory.graph', 'Knowledge graph')}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">graphify-out/</span>
        </div>
        {g?.available ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-violet-500/10 px-2.5 py-1 text-[12px] font-semibold text-violet-300">
              {g.nodes.toLocaleString()} {translate('planide.memory.nodes', 'nodes')}
            </span>
            <span className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-[12px] font-semibold text-sky-300">
              {g.edges.toLocaleString()} {translate('planide.memory.edges', 'edges')}
            </span>
            {g.hasReport && (
              <span className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground">
                GRAPH_REPORT.md
              </span>
            )}
            {g.hasHtml && (
              <span className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground">
                graph.html
              </span>
            )}
            {g.updatedAt && (
              <span className="ml-auto text-[11px] text-muted-foreground/80">
                {translate('planide.memory.updated', 'updated')} {relTimeMs(g.updatedAt)}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[12px] text-muted-foreground">
            {translate(
              'planide.memory.noGraph',
              'No graph yet. graphify builds one automatically when an agent starts a session here, or run `graphify extract .` in the project.'
            )}
          </div>
        )}
      </div>

      {/* Obsidian note */}
      <div className="rounded-xl border border-border bg-card/40 p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <BookText size={15} className={cn(o?.noteExists ? 'text-emerald-400' : 'text-muted-foreground/50')} />
          <span className="text-[12.5px] font-semibold">
            {translate('planide.memory.obsidian', 'Obsidian note')}
          </span>
          {o?.noteExists && o.updatedAt && (
            <span className="ml-auto text-[11px] text-muted-foreground/80">
              {translate('planide.memory.updated', 'updated')} {relTimeMs(o.updatedAt)}
            </span>
          )}
        </div>
        {!o?.vault ? (
          <div className="text-[12px] text-muted-foreground">
            {translate(
              'planide.memory.noVault',
              'No Obsidian vault detected. Open a vault in Obsidian, or set OBSIDIAN_VAULT_PATH, and notes appear here.'
            )}
          </div>
        ) : o.noteExists ? (
          <div className="flex items-start gap-2">
            <ExternalLink size={12} className="mt-[3px] shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">{o.notePath}</span>
          </div>
        ) : (
          <div className="text-[12px] text-muted-foreground">
            {translate(
              'planide.memory.noNote',
              'Vault detected — a note is written under Pulsar/ after an agent finishes meaningful work here.'
            )}
            <div className="mt-1 font-mono text-[10.5px] text-muted-foreground/60">{o.vault}</div>
          </div>
        )}
      </div>

      {loading && !status && (
        <div className="py-6 text-center text-[12px] text-muted-foreground">
          {translate('planide.memory.loading', 'Reading project memory…')}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  dot,
  hint
}: {
  label: string
  value: number | string
  tone?: string
  dot?: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {dot && <span className={cn('size-1.5 shrink-0 rounded-full', dot)} />}
        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn('mt-1 text-[17px] font-semibold leading-none tabular-nums', tone)}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] leading-none text-muted-foreground/70">{hint}</div>}
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
      {/* Orca hides row actions until hover and keeps them visible on touch
          (its own `can-hover:` variant); the board follows that. */}
      <div className="mt-2 flex flex-wrap gap-1.5 can-hover:opacity-0 can-hover:transition-opacity can-hover:group-focus-within:opacity-100 can-hover:group-hover:opacity-100">
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
  const [memory, setMemory] = useState<MemoryStatus | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)

  // quick capture
  const [qTitle, setQTitle] = useState('')
  const [qNotes, setQNotes] = useState('')
  const [qStatus, setQStatus] = useState<ItemStatus>('todo')
  const [qLock, setQLock] = useState(false)
  const [qConfirm, setQConfirm] = useState(false)

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      setProject(await openProject(path))
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
    if (!worktreePath) return
    try {
      setProject(await openProject(worktreePath))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [worktreePath])

  /** Every mutation returns the refreshed project, so one round-trip is enough. */
  const act = useCallback(async (fn: () => Promise<PlanIdeProject>) => {
    try {
      setProject(await fn())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const quickAdd = useCallback(async () => {
    if (!worktreePath || !qTitle.trim()) return
    try {
      const added = await addItem(worktreePath, {
        title: qTitle.trim(),
        status: qStatus,
        notes: qNotes.trim()
      })
      let next = added.payload
      // Flags go through their own channels on purpose: the generic add/update
      // path deliberately cannot set them.
      if (qLock) next = await lockItem(worktreePath, added.result.id, true)
      if (qConfirm) next = await verifyItem(worktreePath, added.result.id, true)
      setProject(next)
      setQTitle('')
      setQNotes('')
      setQLock(false)
      setQConfirm(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [worktreePath, qTitle, qNotes, qStatus, qLock, qConfirm])

  const editItem = useCallback(
    async (item: PlanIdeItem) => {
      const title = window.prompt(translate('planide.view.editTitle', 'Title'), item.title)
      if (title === null) return
      const notes = window.prompt(translate('planide.view.editNotes', 'Notes'), item.notes ?? '')
      if (notes === null) return
      await act(() => updateItem(worktreePath!, item.id, { title, notes }))
    },
    [act, worktreePath]
  )

  useEffect(() => {
    if (tab !== 'ai' || !worktreePath) return
    let cancelled = false
    void aiReport(worktreePath, 'full')
      .then((md) => !cancelled && setBriefing(md))
      .catch((err) => !cancelled && setBriefing(String(err)))
    return () => {
      cancelled = true
    }
  }, [tab, worktreePath])

  const loadMemory = useCallback(async (path: string) => {
    setMemoryLoading(true)
    try {
      setMemory(await memoryStatus(path))
    } catch {
      setMemory(null)
    } finally {
      setMemoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== 'memory' || !worktreePath) return
    void loadMemory(worktreePath)
  }, [tab, worktreePath, loadMemory])

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
    // The one place the full badge belongs: an empty page with room for it.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
        <PlanIdeLogo size={72} className="opacity-90" />
        <div className="text-sm text-muted-foreground">
          {translate('planide.view.noWorkspace', 'Open a workspace to track it.')}
        </div>
        <div className="max-w-sm text-[12px] leading-relaxed text-muted-foreground/70">
          {translate(
            'planide.view.noWorkspaceHint',
            'The tracker follows the workspace you are in: what works, what is broken, what must not be touched — and what the agents did.'
          )}
        </div>
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
        {/* identity — the mark, the project, and the one number that matters */}
        <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {/* The glyph, not the full badge: the app icon is a dark tile with fine
              rings, which turns to mush at header size. Same shape, drawn to be
              read small — the badge itself is the app/dock icon. */}
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-card shadow-sm">
            <PlanIdeMark size={21} strokeWidth={1.9} className="text-rose-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight">
                {project.name}
              </h1>
              {[project.type, `v${project.version}`, ...langs.slice(0, 3)].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-border/80 px-2 py-px text-[10px] font-medium text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground/60">
              {project.path}
            </div>
          </div>
          <ConfirmedRing progress={p} />
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            onClick={() => void refresh()}
          >
            <RefreshCw size={13} /> {translate('planide.view.refresh', 'Refresh')}
          </Button>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Confirmed" value={p.confirmed} tone="text-emerald-500" dot="bg-emerald-500" />
          <Stat
            label="Claimed"
            value={p.unconfirmed}
            tone={p.unconfirmed ? 'text-amber-500' : undefined}
            dot="bg-amber-500"
            hint={p.unconfirmed ? 'nobody checked' : undefined}
          />
          <Stat label="Complete" value={p.complete} dot="bg-violet-500" />
          <Stat label="Still open" value={p.open} dot="bg-muted-foreground" />
          <Stat
            label="Protected"
            value={p.protected}
            tone={p.regressed ? 'text-rose-500' : 'text-violet-400'}
            dot="bg-violet-400"
          />
          <Stat label="Broken" value={p.broken} tone={p.broken ? 'text-rose-500' : undefined} dot="bg-rose-500" />
        </div>

        {regressed.length > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rose-500/50 bg-rose-500/10 px-3.5 py-3">
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

        {/* Quick capture — your own board, fast. Only where it belongs: on the
            GitHub or Backups tab it would be a form for the wrong thing. */}
        {(tab === 'board' || tab === 'protected') && (
        <div className="mt-4 rounded-xl border border-border bg-card/40 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={qTitle}
              onChange={(e) => setQTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
              placeholder={translate(
                'planide.view.qTitle',
                'What just broke, or what just started working?'
              )}
              className="min-w-[240px] flex-[3] rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-ring"
            />
            <select
              value={qStatus}
              onChange={(e) => setQStatus(e.target.value as ItemStatus)}
              className="rounded-lg border border-border bg-background px-2 py-2 text-[12px] outline-none focus:border-ring"
            >
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Button size="sm" className="h-[34px]" onClick={() => void quickAdd()}>
              <Plus size={13} /> {translate('planide.view.add', 'Add')}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <input
              value={qNotes}
              onChange={(e) => setQNotes(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
              placeholder={translate('planide.view.qNotes', 'details (optional) — what exactly happens?')}
              className="min-w-[240px] flex-[3] rounded-lg border border-transparent bg-muted/40 px-3 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background"
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={qLock} onChange={(e) => setQLock(e.target.checked)} />
              <Lock size={10} /> {translate('planide.view.qLock', 'protect (do not break)')}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={qConfirm}
                onChange={(e) => setQConfirm(e.target.checked)}
              />
              <ShieldCheck size={10} /> {translate('planide.view.qConfirm', 'I confirmed this works')}
            </label>
          </div>
        </div>
        )}

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
            <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {COLUMNS.map((col) => {
                const items = shown.filter((i) => i.status === col.id)
                return (
                  <div
                    key={col.id}
                    className="overflow-hidden rounded-xl border border-border/60 bg-card/20"
                  >
                    <div className={cn('h-[3px] w-full opacity-70', col.dot)} />
                    <div className="p-2.5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {col.label}
                      <span className="ml-auto tabular-nums">{items.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {items.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          onCycle={(i) => void act(() => setItemStatus(worktreePath, i.id, NEXT_STATUS[i.status]))}
                          onVerify={(i) => void act(() => verifyItem(worktreePath, i.id, !i.verified))}
                          onLock={(i) => void act(() => lockItem(worktreePath, i.id, !i.locked))}
                          onEdit={(i) => void editItem(i)}
                          onDelete={(i) => {
                            if (window.confirm(translate('planide.view.confirmDelete', 'Delete this item?')))
                              void act(() => deleteItem(worktreePath, i.id))
                          }}
                        />
                      ))}
                      {items.length === 0 && (
                        <div className="py-3 text-center text-[11px] text-muted-foreground/40">
                          {translate('planide.view.columnEmpty', 'nothing here')}
                        </div>
                      )}
                    </div>
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
                        onCycle={(i) => void act(() => setItemStatus(worktreePath, i.id, NEXT_STATUS[i.status]))}
                        onVerify={(i) => void act(() => verifyItem(worktreePath, i.id, !i.verified))}
                        onLock={(i) => void act(() => lockItem(worktreePath, i.id, !i.locked))}
                        onEdit={(i) => void editItem(i)}
                        onDelete={(i) => void act(() => deleteItem(worktreePath, i.id))}
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
                          onCycle={(i) => void act(() => setItemStatus(worktreePath, i.id, NEXT_STATUS[i.status]))}
                          onVerify={(i) => void act(() => verifyItem(worktreePath, i.id, !i.verified))}
                          onLock={(i) => void act(() => lockItem(worktreePath, i.id, !i.locked))}
                          onEdit={(i) => void editItem(i)}
                          onDelete={(i) => void act(() => deleteItem(worktreePath, i.id))}
                        />
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'fixes' && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  const title = window.prompt(translate('planide.view.newFix', 'What went wrong?'))
                  if (!title) return
                  const problem =
                    window.prompt(translate('planide.view.fixProblem', 'Detail (optional)')) ?? ''
                  void act(() => addFix(worktreePath, { title, problem }))
                }}
                className="mb-2 flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                <Wrench size={12} /> {translate('planide.view.addFix', 'Log a fix')}
              </button>
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
                      onClick={() => void act(() => markFixDone(worktreePath, f.id))}
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
                    onClick={() => void act(() => toggleMilestone(worktreePath, m.id, !m.done))}
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
                  void act(() => addMilestone(worktreePath, title, target))
                }}
                className="mt-2 flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:border-ring hover:text-foreground"
              >
                <Flag size={12} /> {translate('planide.view.addMilestone', 'Add milestone')}
              </button>
            </div>
          )}

          {tab === 'versions' && (
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={() => {
                  const version = window.prompt(
                    translate('planide.view.newVersion', 'Version'),
                    project.version
                  )
                  if (!version) return
                  const notes = window.prompt(translate('planide.view.versionNotes', 'Notes')) ?? ''
                  void act(() => addVersion(worktreePath, version, { notes }))
                }}
                className="flex items-center gap-1.5 self-start rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                <Tag size={12} /> {translate('planide.view.cutVersion', 'Cut a version')}
              </button>
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

          {(tab === 'sync' || tab === 'backups') && (
            <Suspense
              fallback={
                <div className="flex items-center gap-2 p-6 text-[12px] text-muted-foreground">
                  <Loader2 className="animate-spin" size={14} />
                  {translate('planide.view.loadingTab', 'Loading…')}
                </div>
              }
            >
              {tab === 'sync' ? (
                <PlanIdeSync
                  path={worktreePath}
                  autoPush={project.github?.auto_push === true}
                  lastSync={project.github?.last_sync ?? ''}
                  onProject={(next) => setProject(next as PlanIdeProject)}
                />
              ) : (
                <PlanIdeBackups path={worktreePath} version={project.version} />
              )}
            </Suspense>
          )}

          {tab === 'activity' && (
            <div className="flex flex-col">
              {(() => {
                const accounts = accountsFromActivity(project.activity ?? [])
                if (accounts.length === 0) return null
                const totalTurns = accounts.reduce((n, a) => n + a.turns, 0)
                return (
                  <div className="mb-4">
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {translate('planide.view.byAccount', 'Agent work by account')} · {totalTurns}{' '}
                      {translate('planide.view.turns', 'turns')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((acc) => (
                        <div
                          key={acc.account}
                          className="flex items-center gap-2.5 rounded-xl border border-border bg-card/40 px-3 py-2"
                        >
                          <PlanIdeMark size={15} />
                          <div className="leading-tight">
                            <div className="text-[12.5px] font-semibold capitalize">{acc.account}</div>
                            <div className="text-[10.5px] text-muted-foreground">
                              {acc.turns} {acc.turns === 1 ? translate('planide.view.turn', 'turn') : translate('planide.view.turns', 'turns')}
                              {acc.lastAt ? ` · ${relTime(acc.lastAt)}` : ''}
                            </div>
                          </div>
                          <div className="ml-1 h-1.5 w-16 overflow-hidden rounded-full bg-border/60">
                            <div
                              className="h-full rounded-full bg-violet-400/80"
                              style={{ width: `${Math.round((acc.turns / accounts[0].turns) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
              {(project.activity ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
                  {translate('planide.view.noActivity', 'Nothing recorded yet.')}
                </div>
              )}
              {(project.activity ?? []).map((a) => (
                <ActivityRow key={a.id} entry={a} />
              ))}
            </div>
          )}

          {tab === 'memory' && (
            <MemoryPanel
              status={memory}
              loading={memoryLoading}
              onRefresh={() => worktreePath && void loadMemory(worktreePath)}
            />
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
