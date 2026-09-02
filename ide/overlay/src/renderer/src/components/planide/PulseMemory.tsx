/**
 * Pulse memory: the Brain Graph and the Obsidian notes, as their own surfaces.
 *
 * These used to be two tabs inside the Tracker page. They are memory, not the
 * board, and you want them open *while* you work rather than by leaving the
 * board — so they now live in the right sidebar next to the Tracker, and this
 * file is the shared rendering both surfaces use.
 *
 * Everything here is read-only: it reports what the SessionStart hook and the
 * tracker's memory-sync have already written for this project. A missing graph,
 * vault or note is a normal "not yet" state, never an error.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BookText, ExternalLink, Hammer, Network, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import { GraphCanvas } from './GraphCanvas'
import {
  graphReport as fetchGraphReport,
  graphPicture as fetchGraphPicture,
  reindexGraph as runReindexGraph,
  memoryStatus as fetchMemoryStatus,
  type BrainGraph,
  type GraphPicture,
  type GraphReportSection,
  type MemoryStatus,
  type ObsidianStatus,
  withVisibleSpin,
  openGraphWindow
} from '../right-sidebar/planide-engine-client'

/** relTime for an epoch-ms timestamp (memory-status uses file mtimes, not ISO). */
function relTimeMs(ms: number | null): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function BreakdownRow({
  name,
  count,
  max,
  tone
}: {
  name: string
  count: number
  max: number
  tone: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[104px] shrink-0 truncate text-[11.5px] text-muted-foreground">{name}</span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border/50">
        <div
          className={cn('h-full rounded-full', tone)}
          style={{ width: `${max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[11.5px] font-medium tabular-nums">{count}</span>
    </div>
  )
}

/** A big number with a caption — the top row of both memory panels. */
function MemoryStat({ value, label }: { value: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 px-3.5 py-2.5">
      <div className="text-[19px] font-semibold leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[10.5px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  )
}

function PanelHeader({
  hint,
  loading,
  onRefresh,
  onRebuild,
  rebuilding
}: {
  hint: string
  loading: boolean
  onRefresh: () => void
  /** Only the graph can be rebuilt; the Obsidian panel passes nothing. */
  onRebuild?: () => void
  rebuilding?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-muted-foreground">{hint}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {onRebuild ? (
          <Button size="sm" onClick={onRebuild} disabled={rebuilding || loading}>
            <Hammer size={13} className={cn(rebuilding && 'animate-pulse')} />{' '}
            {rebuilding
              ? translate('planide.brain.rebuilding', 'Rebuilding…')
              : translate('planide.brain.rebuild', 'Rebuild graph')}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading || rebuilding}>
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />{' '}
          {translate('planide.memory.refresh', 'Refresh')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Brain Graph — what the project's knowledge graph actually contains.
 *
 * graphify's own dashboard leads with the same things: how big the graph is, the
 * hubs everything hangs off ("god nodes"), and how much of it was read straight
 * out of the code versus inferred. This shows them without leaving the IDE, and
 * refreshes itself when an agent works.
 */
export function BrainGraphPanel({
  graph,
  loading,
  onRefresh,
  report,
  onRebuild,
  rebuilding,
  rebuildLog,
  picture
}: {
  graph: BrainGraph | null
  loading: boolean
  onRefresh: () => void
  /** graphify's own report, section by section. Empty until a rebuild runs. */
  report?: GraphReportSection[]
  onRebuild?: () => void
  rebuilding?: boolean
  /** graphify's own words when a rebuild fails -- shown rather than swallowed. */
  rebuildLog?: string
  /** The drawable slice of the graph. Null until it has been read. */
  picture?: GraphPicture | null
}): React.JSX.Element {
  const CONFIDENCE_TONE: Record<string, string> = {
    EXTRACTED: 'bg-emerald-500/80',
    INFERRED: 'bg-amber-500/80',
    AMBIGUOUS: 'bg-rose-500/70'
  }
  return (
    <div className="flex flex-col gap-3">
      <PanelHeader
        hint={translate(
          'planide.brain.hint',
          'The knowledge graph of this project — built automatically as agents work here.'
        )}
        loading={loading}
        onRefresh={onRefresh}
        onRebuild={onRebuild}
        rebuilding={rebuilding}
      />

      {/* Indexing reads the whole project, so it takes real time with no
          percentage to report. A travelling bar says "running"; the spinner on
          the button alone left it ambiguous whether anything had started. */}
      {rebuilding ? (
        <div aria-busy="true" aria-live="polite">
          <div className="pulsar-progress" />
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            {translate('planide.brain.rebuildingHint', 'Reading the project and rebuilding the graph…')}
          </div>
        </div>
      ) : null}

      {/* graphify's own words. Only ever shown when a rebuild actually failed:
          a silent no-op is what made Refresh feel broken in the first place. */}
      {rebuildLog ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-[11px] text-muted-foreground">
          {rebuildLog}
        </pre>
      ) : null}

      {!graph?.available ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Network size={20} className="mx-auto mb-2 text-muted-foreground/50" />
          <div className="text-[12.5px] font-medium">
            {translate('planide.brain.none', 'No graph for this project yet')}
          </div>
          <div className="mx-auto mt-1 max-w-[42ch] text-[11.5px] text-muted-foreground">
            {translate(
              'planide.brain.noneHint',
              'One is built the first time an agent starts a session here. You can also run `graphify extract .` in the project.'
            )}
          </div>
        </div>
      ) : graph.tooLarge ? (
        <div className="rounded-xl border border-border bg-card/40 p-4 text-[12px] text-muted-foreground">
          {translate(
            'planide.brain.tooLarge',
            'This graph is very large, so it is not summarised here to keep the window responsive.'
          )}{' '}
          ({Math.round(graph.sizeBytes / (1024 * 1024))} MB)
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MemoryStat value={graph.nodes.toLocaleString()} label={translate('planide.brain.nodes', 'Nodes')} />
            <MemoryStat value={graph.edges.toLocaleString()} label={translate('planide.brain.edges', 'Connections')} />
            <MemoryStat
              value={graph.communities.toLocaleString()}
              label={translate('planide.brain.communities', 'Clusters')}
            />
            <MemoryStat
              value={graph.indexedFiles.toLocaleString()}
              label={translate('planide.brain.files', 'Files indexed')}
            />
          </div>

          {picture?.available && (
            <div className="rounded-xl border border-border bg-card/40 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {translate('planide.brain.shape', 'The shape of this project')}
                </span>
                {/* graphify writes its own full, explorable view of the same
                    graph. This picture is the one that fits beside the numbers;
                    that one is the whole thing, so link to it rather than
                    reimplementing it. */}
                {graph.htmlPath ? (
                  <button
                    type="button"
                    onClick={() => void openGraphWindow(graph.htmlPath as string)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink size={11} />
                    {translate('planide.brain.openFull', "Open graphify's full view")}
                  </button>
                ) : null}
              </div>
              <GraphCanvas picture={picture} />
            </div>
          )}

          {graph.hubs.length > 0 && (
            <div className="rounded-xl border border-border bg-card/40 p-3.5">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('planide.brain.hubs', 'What the project hangs off')}
              </div>
              <div className="flex flex-col gap-1.5">
                {graph.hubs.map((h) => (
                  <div key={h.id} className="flex items-baseline gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{h.label}</span>
                    {h.file && (
                      <span className="shrink-0 truncate font-mono text-[10.5px] text-muted-foreground/70">
                        {h.file}
                      </span>
                    )}
                    <span className="shrink-0 rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-violet-300 tabular-nums">
                      {h.degree}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {graph.relations.length > 0 && (
              <div className="rounded-xl border border-border bg-card/40 p-3.5">
                <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {translate('planide.brain.relations', 'How things relate')}
                </div>
                <div className="flex flex-col gap-2">
                  {graph.relations.slice(0, 6).map((r) => (
                    <BreakdownRow
                      key={r.name}
                      name={r.name}
                      count={r.count}
                      max={graph.relations[0].count}
                      tone="bg-violet-400/80"
                    />
                  ))}
                </div>
              </div>
            )}

            {graph.confidence.length > 0 && (
              <div className="rounded-xl border border-border bg-card/40 p-3.5">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {translate('planide.brain.confidence', 'How it was learned')}
                </div>
                <div className="mb-2.5 text-[10.5px] text-muted-foreground/80">
                  {translate(
                    'planide.brain.confidenceHint',
                    'Extracted = read from the code. Inferred = worked out. Ambiguous = unsure.'
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {graph.confidence.map((c) => (
                    <BreakdownRow
                      key={c.name}
                      name={c.name.toLowerCase()}
                      count={c.count}
                      max={graph.confidence[0].count}
                      tone={CONFIDENCE_TONE[c.name] ?? 'bg-sky-500/70'}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {graph.kinds.map((k) => (
              <span key={k.name} className="rounded-md border border-border px-2 py-0.5">
                {k.count} {k.name}
              </span>
            ))}
            {graph.hasReport && (
              <span className="rounded-md border border-border px-2 py-0.5">GRAPH_REPORT.md</span>
            )}
            {graph.hasHtml &&
              (graph.htmlPath ? (
                <a
                  href={`file://${graph.htmlPath}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:border-primary/50 hover:text-foreground"
                >
                  <ExternalLink size={10} />
                  graph.html
                </a>
              ) : (
                <span className="rounded-md border border-border px-2 py-0.5">graph.html</span>
              ))}
            {graph.updatedAt && (
              <span className="ml-auto">
                {translate('planide.memory.updated', 'updated')} {relTimeMs(graph.updatedAt)}
              </span>
            )}
          </div>

          {/* graphify's own report, verbatim. The headings are its, not ours,
              so a section a future version adds shows up on its own instead of
              being dropped by a parser that only knows today's set. This is the
              half of the graph the IDE never showed: god nodes, the connections
              you did not know about, import cycles, and what it cannot answer. */}
          {report && report.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('planide.brain.report', "Graphify's report")}
              </div>
              {report.map((section) => (
                <div key={section.heading} className="rounded-lg border border-border p-3">
                  <div className="mb-1.5 text-[12px] font-medium">{section.heading}</div>
                  <div className="flex flex-col gap-1">
                    {section.lines.map((line, i) => (
                      <div
                        key={i}
                        className="text-[11.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {line.replace(/^[-*]\s+/, '• ')}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * Obsidian — the notes the agent keeps, per project.
 *
 * The vault is found the same way the note writer finds it, and every project
 * note in it is listed, so this is the whole memory rather than just this one
 * project's line.
 */
export function ObsidianPanel({
  status,
  loading,
  onRefresh
}: {
  status: ObsidianStatus | null
  loading: boolean
  onRefresh: () => void
}): React.JSX.Element {
  const SOURCE_LABEL: Record<string, string> = {
    setting: 'from your setting',
    env: 'from OBSIDIAN_VAULT_PATH',
    detected: 'detected automatically'
  }
  return (
    <div className="flex flex-col gap-3">
      <PanelHeader
        hint={translate(
          'planide.obsidian.hint',
          'Notes the agent writes for each project, in your own vault.'
        )}
        loading={loading}
        onRefresh={onRefresh}
      />

      {!status?.vault ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <BookText size={20} className="mx-auto mb-2 text-muted-foreground/50" />
          <div className="text-[12.5px] font-medium">
            {translate('planide.obsidian.noVault', 'No Obsidian vault found')}
          </div>
          <div className="mx-auto mt-1 max-w-[46ch] text-[11.5px] text-muted-foreground">
            {translate(
              'planide.obsidian.noVaultHint',
              'Open a vault in Obsidian once, or set OBSIDIAN_VAULT_PATH, and notes appear here by themselves.'
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card/40 p-3.5">
            <div className="flex items-center gap-2">
              <BookText size={14} className="shrink-0 text-emerald-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{status.vault}</span>
              {status.source && (
                <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {SOURCE_LABEL[status.source] ?? status.source}
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-3.5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('planide.obsidian.thisProject', 'This project')}
              </span>
              {status.noteExists && status.updatedAt && (
                <span className="ml-auto text-[11px] text-muted-foreground/80">
                  {translate('planide.memory.updated', 'updated')} {relTimeMs(status.updatedAt)}
                </span>
              )}
            </div>
            {status.noteExists ? (
              <>
                <div className="flex items-start gap-2">
                  <ExternalLink size={12} className="mt-[3px] shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                    {status.notePath}
                  </span>
                </div>
                {status.excerpt && (
                  <pre className="mt-2.5 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/40 p-2.5 font-mono text-[11px] leading-relaxed scrollbar-sleek">
                    {status.excerpt}
                  </pre>
                )}
              </>
            ) : (
              <div className="text-[12px] text-muted-foreground">
                {translate(
                  'planide.obsidian.noNote',
                  'No note yet — one is written under Pulse/ after an agent finishes real work here.'
                )}
              </div>
            )}
          </div>

          {status.notes.length > 0 && (
            <div className="rounded-xl border border-border bg-card/40 p-3.5">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {translate('planide.obsidian.allNotes', 'Everything remembered')} · {status.notes.length}
              </div>
              <div className="flex flex-col">
                {status.notes.slice(0, 20).map((n) => (
                  <div
                    key={n.path}
                    className={cn(
                      'flex items-baseline gap-2.5 border-b border-border/40 py-1.5 text-[12px] last:border-none',
                      n.path === status.notePath && 'font-medium text-emerald-400'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{n.name}</span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground/70">
                      {relTimeMs(n.updatedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}


// --------------------------------------------------------------------------- sidebar

/**
 * Load this project's memory once per surface.
 *
 * The graph and the notes are written by background jobs (the SessionStart hook,
 * the tracker's memory-sync), so there is no file to watch that would tell us
 * "now" — hence a real refresh control rather than a live subscription. It spins
 * while it reads and stamps when it last read, because a refresh that finds
 * nothing new must still visibly have happened.
 */
/**
 * How old a graph may get before the panel refreshes it on its own. A day is
 * long enough that a normal working session never triggers it, and short enough
 * that the graph is not describing last week's code.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function useMemory(worktreePath: string | undefined): {
  status: MemoryStatus | null
  loading: boolean
  refresh: () => void
  report: GraphReportSection[]
  rebuild: () => void
  rebuilding: boolean
  rebuildLog: string
  picture: GraphPicture | null
  autoRebuilt: boolean
} {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [report, setReport] = useState<GraphReportSection[]>([])
  const [loading, setLoading] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildLog, setRebuildLog] = useState('')
  const [picture, setPicture] = useState<GraphPicture | null>(null)
  const [autoRebuilt, setAutoRebuilt] = useState(false)
  // One automatic rebuild per project per session. Rebuilding reads the whole
  // project, so doing it on every visit would be a tax; never doing it is how
  // the graph sat four days stale while agents worked in here daily.
  const autoTried = useRef<string | null>(null)

  const refresh = useCallback(() => {
    if (!worktreePath) return
    void withVisibleSpin(setLoading, async () => {
      const [s, r, p] = await Promise.all([
        fetchMemoryStatus(worktreePath).catch(() => null),
        // Best-effort: a project with no report yet is a normal state, not an error.
        fetchGraphReport(worktreePath).catch(() => [] as GraphReportSection[]),
        fetchGraphPicture(worktreePath).catch(() => null)
      ])
      setStatus(s)
      setReport(r ?? [])
      setPicture(p)
    })
  }, [worktreePath])

  /**
   * Actually rebuild, then re-read. Refresh alone only ever re-read what was on
   * disk, so it returned identical numbers every time and looked like it did
   * nothing -- which is exactly how it was reported.
   */
  const rebuild = useCallback(() => {
    if (!worktreePath) return
    setRebuilding(true)
    setRebuildLog('')
    void runReindexGraph(worktreePath)
      .then((r) => {
        // Only surface the log on failure; a successful build speaks through
        // the numbers and the report that follow it.
        if (!r?.ok) setRebuildLog(r?.log || 'Could not rebuild the graph.')
      })
      .catch((e) => setRebuildLog(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setRebuilding(false)
        refresh()
      })
  }, [worktreePath, refresh])

  useEffect(() => {
    if (!worktreePath) {
      setStatus(null)
      setReport([])
      setPicture(null)
      return
    }
    refresh()
  }, [worktreePath, refresh])

  /**
   * Keep it current on its own.
   *
   * The graph only ever moved when someone pressed Rebuild, so in a project
   * agents touch every day it read "updated 4 days ago" -- stale enough to be
   * misleading rather than merely old. When the graph exists and is older than
   * a day, rebuild it once, in the background, the first time this project is
   * opened in this session. Bounded on purpose: never for a project with no
   * graph yet (that is a deliberate first run, not a refresh), never twice, and
   * never while one is already running.
   */
  useEffect(() => {
    if (!worktreePath || rebuilding) return
    if (autoTried.current === worktreePath) return
    const graph = status?.graphify
    if (!graph?.available || graph.updatedAt === null) return
    if (Date.now() - graph.updatedAt < STALE_AFTER_MS) return
    autoTried.current = worktreePath
    setAutoRebuilt(true)
    rebuild()
  }, [worktreePath, status, rebuilding, rebuild])

  return { status, loading, refresh, report, rebuild, rebuilding, rebuildLog, picture, autoRebuilt }
}

export function NoProject(): React.JSX.Element {
  return (
    <div className="p-3 text-[11px] text-muted-foreground">
      {translate('planide.memory.noProject', 'Open a project to see its memory.')}
    </div>
  )
}

/** Scroll container only: each panel already renders its own header + refresh. */
function SidebarScroll({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 scrollbar-sleek">{children}</div>
}

/** The Brain Graph, as its own right-sidebar tab. */
export function BrainGraphSidebar(): React.JSX.Element {
  const worktreePath = useActiveWorktree()?.path ?? undefined
  const { status, loading, refresh, report, rebuild, rebuilding, rebuildLog, picture } =
    useMemory(worktreePath)
  if (!worktreePath) return <NoProject />
  return (
    <SidebarScroll>
      <BrainGraphPanel
        graph={status?.graphify ?? null}
        loading={loading}
        onRefresh={refresh}
        report={report}
        onRebuild={rebuild}
        rebuilding={rebuilding}
        rebuildLog={rebuildLog}
        picture={picture}
      />
    </SidebarScroll>
  )
}

/** The Obsidian vault + this project's note, as its own right-sidebar tab. */
export function ObsidianSidebar(): React.JSX.Element {
  const worktreePath = useActiveWorktree()?.path ?? undefined
  const { status, loading, refresh } = useMemory(worktreePath)
  if (!worktreePath) return <NoProject />
  return (
    <SidebarScroll>
      <ObsidianPanel status={status?.obsidian ?? null} loading={loading} onRefresh={refresh} />
    </SidebarScroll>
  )
}
