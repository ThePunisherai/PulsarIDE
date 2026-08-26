/**
 * Brain Graph as a full page, reached from the left nav under Tracker.
 *
 * Same data as the sidebar tab of the same name -- this adds no new source and
 * invents no numbers. What it adds is room: in a 300px column the hubs, the
 * relation mix, the node kinds and the confidence split are stacked so far apart
 * that you cannot hold them in your head at once. Here they sit side by side,
 * which is the whole point of a graph overview.
 *
 * The project's Obsidian note rides along in its own column: it is the same
 * project memory, written by the same hook, and reading them together is how you
 * actually check whether the agents understood the codebase.
 */
import React from 'react'
import { Network } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import {
  BrainGraphPanel,
  NoProject,
  ObsidianPanel,
  useMemory
} from './PulseMemory'

export default function PulseMemoryPage(): React.JSX.Element {
  const worktree = useActiveWorktree()
  const worktreePath = worktree?.path ?? undefined
  const { status, loading, refresh } = useMemory(worktreePath)

  if (!worktreePath) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-sleek">
        <NoProject />
      </div>
    )
  }

  const graph = status?.graphify ?? null
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-sleek">
      <header className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <Network className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">
            {translate('planide.nav.brain', 'Brain Graph')}
          </h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {/* The path, not a claim about what is in it. */}
            {worktreePath}
          </p>
        </div>
        {/* A live node count belongs in the header: it is the one number that
            says at a glance whether this project has been indexed at all. */}
        {graph?.available ? (
          <span className="ml-auto shrink-0 rounded-md bg-muted/60 px-2 py-1 text-[11px] font-medium tabular-nums text-muted-foreground">
            {graph.nodes.toLocaleString()} nodes · {graph.edges.toLocaleString()} connections
          </span>
        ) : null}
      </header>

      {/* Two columns from lg up, one below it -- the panels are the same
          components the sidebar uses, so nothing here can drift from them. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="min-w-0">
          <BrainGraphPanel graph={graph} loading={loading} onRefresh={refresh} />
        </section>
        <section className="min-w-0">
          <ObsidianPanel status={status?.obsidian ?? null} loading={loading} onRefresh={refresh} />
        </section>
      </div>
    </div>
  )
}
