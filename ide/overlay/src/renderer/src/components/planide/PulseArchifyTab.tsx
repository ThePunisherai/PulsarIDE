/**
 * Archify as a right-sidebar tab.
 *
 * A thin wrapper so the sidebar can lazy-load a default export: the panel needs
 * the active project's path, and the sidebar renders its tabs without props.
 * The panel itself is shared with the full page, so the two cannot disagree
 * about which diagrams exist.
 */
import React from 'react'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import { ArchifySidebar } from './PulseArchify'

export default function PulseArchifyTab(): React.JSX.Element {
  const worktree = useActiveWorktree()
  const worktreePath = worktree?.path ?? ''

  if (!worktreePath) {
    return (
      <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
        {translate('planide.archify.noProject', 'Open a project to see its diagrams.')}
      </div>
    )
  }
  return (
    <div className="p-3">
      <ArchifySidebar worktreePath={worktreePath} />
    </div>
  )
}
