/**
 * Archify as a full page, reached from the left nav under Tracker.
 *
 * The same component as the sidebar tab rather than a second implementation --
 * two renderings of "which diagrams exist and are they current" is how they end
 * up disagreeing. What the page adds is a readable measure for archify's own
 * validation output, which points at lines in a JSON document and is unreadable
 * wrapped into a 300px column.
 */
import React from 'react'
import { Workflow } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import { ArchifySidebar } from './PulseArchify'

export default function PulseArchifyPage(): React.JSX.Element {
  const worktree = useActiveWorktree()
  const worktreePath = worktree?.path ?? ''

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-sleek">
      <header className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <Workflow className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">
            {translate('planide.nav.archify', 'Archify')}
          </h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {translate(
              'planide.archify.pageSubtitle',
              'Architecture, workflow, sequence, data-flow and lifecycle diagrams your agents draw from the real code.'
            )}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-6">
        <div className="mx-auto w-full max-w-3xl">
          {worktreePath ? (
            <ArchifySidebar worktreePath={worktreePath} />
          ) : (
            <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-8 text-center text-[12px] text-muted-foreground">
              {translate('planide.archify.noProject', 'Open a project to see its diagrams.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
