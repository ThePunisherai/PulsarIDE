/**
 * Archify: this project's diagrams.
 *
 * Archify (MIT, bundled) compiles a typed JSON description into a
 * self-contained interactive HTML diagram. The agents write the JSON -- that is
 * the part that needs judgment about what the system actually does -- and this
 * panel is where you see what they produced, re-render one after it changed,
 * and open it.
 *
 * It deliberately does not offer a "make me a diagram" button. Archify's own
 * design is that a diagram must reflect real structure rather than invented
 * topology, and a button here could only guess. Asking an agent for the diagram
 * you want is the path that produces a truthful one.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Network, RefreshCw, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  archifyRender,
  archifyStatus,
  withVisibleSpin,
  type ArchifyDiagram,
  type ArchifyStatus
} from '../right-sidebar/planide-engine-client'

/** Human labels for archify's five diagram kinds. */
const TYPE_LABEL: Record<string, string> = {
  architecture: 'Architecture',
  workflow: 'Workflow',
  sequence: 'Sequence',
  dataflow: 'Data flow',
  lifecycle: 'Lifecycle'
}

function ago(ms: number): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function ArchifySidebar({ worktreePath }: { worktreePath: string }): React.JSX.Element {
  const [status, setStatus] = useState<ArchifyStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState('')

  const refresh = useCallback(() => {
    if (!worktreePath) return
    void withVisibleSpin(setLoading, async () => {
      try {
        setStatus(await archifyStatus(worktreePath))
      } catch {
        setStatus(null)
      }
    })
  }, [worktreePath])

  useEffect(refresh, [refresh])

  const render = useCallback(
    async (d: ArchifyDiagram) => {
      const key = `${d.name}.${d.type}`
      setBusy(key)
      setLog('')
      try {
        const res = await archifyRender(worktreePath, d.name, d.type)
        // Archify's own output verbatim: a schema error is the useful part, and
        // paraphrasing it would lose the line it points at.
        if (!res.ok) setLog(res.log || 'archify render failed')
        refresh()
      } catch (err) {
        setLog(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
      }
    },
    [worktreePath, refresh]
  )

  const diagrams = status?.diagrams ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-medium">
            {translate('planide.archify.title', 'Diagrams')}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {status?.available === false
              ? translate('planide.archify.unavailable', 'Archify is not deployed yet.')
              : translate('planide.archify.hint', 'Ask an agent for a diagram; it appears here.')}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {diagrams.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-6 text-center text-[12px] text-muted-foreground">
          {translate(
            'planide.archify.empty',
            'No diagrams yet. Ask an agent to diagram this project and it will land here.'
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {diagrams.map((d) => {
            const key = `${d.name}.${d.type}`
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2"
              >
                <Workflow size={14} className="shrink-0 text-primary/80" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium">{d.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {TYPE_LABEL[d.type] ?? d.type}
                    {d.updatedAt ? ` · ${ago(d.updatedAt)}` : ''}
                    {d.html && d.stale
                      ? ` · ${translate('planide.archify.stale', 'source changed since it was rendered')}`
                      : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => void render(d)}
                  disabled={busy === key}
                >
                  <RefreshCw size={11} className={cn('mr-1', busy === key && 'animate-spin')} />
                  {d.html
                    ? translate('planide.archify.rerender', 'Re-render')
                    : translate('planide.archify.render', 'Render')}
                </Button>
                {d.html ? (
                  <a
                    href={`file://${d.html}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink size={11} />
                    {translate('planide.archify.open', 'Open')}
                  </a>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {log ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] leading-relaxed text-muted-foreground scrollbar-sleek">
          {log}
        </pre>
      ) : null}

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Network size={11} className="shrink-0" />
        {translate(
          'planide.archify.where',
          'Diagrams live in .planide/diagrams, beside the board.'
        )}
      </div>
    </div>
  )
}
