/**
 * Open Design as a full page, reached from the left nav under Tracker.
 *
 * Deliberately the same component as the sidebar tab rather than a second
 * implementation: the panel talks to OpenDesign's own CLI, and having two
 * renderings of that state is how they end up disagreeing about whether `od` is
 * installed. This wraps it in a page header and gives it a readable measure --
 * the connect output is command output, and command output in a 300px column is
 * unreadable.
 */
import React from 'react'
import { PenTool } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { OpenDesignSidebar } from './PulseDesign'

export default function PulseDesignPage(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-sleek">
      <header className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <PenTool className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">
            {translate('planide.nav.design', 'Open Design')}
          </h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {translate(
              'planide.design.pageSubtitle',
              'Design work your agents can drive -- prototypes, decks and documents.'
            )}
          </p>
        </div>
      </header>
      {/* max-w so command output wraps at a readable measure instead of
          stretching across an ultrawide display. */}
      <div className="min-h-0 flex-1 p-6">
        <div className="mx-auto w-full max-w-3xl">
          <OpenDesignSidebar />
        </div>
      </div>
    </div>
  )
}
