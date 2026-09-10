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
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Check, ExternalLink, Network, RefreshCw, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  archifyRender,
  archifyStatus,
  meshySetKey,
  meshyStatus,
  openGraphWindow,
  withVisibleSpin,
  type ArchifyDiagram,
  type ArchifyStatus,
  type MeshyStatus
} from '../right-sidebar/planide-engine-client'

/**
 * Meshy's key, next to the diagrams.
 *
 * Meshy generates real 3D models from a description, and it is a paid API, so
 * it cannot ship switched on: with no key its MCP server exits on startup and
 * every agent shows a broken tool. One field is the whole setup -- saving it
 * registers the server for Claude Code, Codex, Cursor, Gemini and Qwen at once,
 * clearing it removes it again.
 *
 * The saved key is never read back into the field. Only a short hint comes
 * back from the main process, which is enough to tell one key from another
 * without putting a secret on screen or in a DOM node.
 */
export function MeshyKey(): React.JSX.Element {
  const [status, setStatus] = useState<MeshyStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void meshyStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (value: string) => {
    setSaving(true)
    try {
      setStatus(await meshySetKey(value))
      setDraft('')
    } catch {
      /* the status line below is the feedback; a toast here would be noise */
    } finally {
      setSaving(false)
    }
  }, [])

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Box size={14} className="shrink-0 text-primary/80" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium">
            {translate('planide.meshy.title', 'Meshy 3D')}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {status?.configured
              ? translate('planide.meshy.on', 'Available to every agent') + ` · ${status.hint}`
              : translate('planide.meshy.off', 'Paste an API key to turn it on')}
          </div>
        </div>
        {status?.configured && <Check size={13} className="shrink-0 text-emerald-500" />}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) void save(draft)
          }}
          placeholder="msy_..."
          spellCheck={false}
          autoComplete="off"
          className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 font-mono text-[11px] outline-none focus:border-primary/60"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={saving || !draft.trim()}
          onClick={() => void save(draft)}
        >
          {translate('planide.meshy.save', 'Save')}
        </Button>
        {status?.configured && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px] text-muted-foreground"
            disabled={saving}
            onClick={() => void save('')}
          >
            {translate('planide.meshy.clear', 'Clear')}
          </Button>
        )}
      </div>
    </div>
  )
}

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

  /**
   * Render what an agent wrote, without waiting to be asked.
   *
   * An agent produces the diagram's JSON -- that part needs judgment about what
   * the system really does, which is why there is still no "invent me a diagram"
   * button. Compiling that JSON to HTML needs no judgment at all, so leaving it
   * behind a manual Render click just meant diagrams sat there unrendered.
   *
   * One per pass, and every key is remembered before the attempt: refresh() will
   * re-run this effect for the next one, and a diagram that fails to render is
   * never retried in a loop -- its error is shown and Render stays available.
   */
  const autoRendered = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!worktreePath || !status) return
    const pending = (status.diagrams ?? []).filter(
      (d) => (!d.html || d.stale) && !autoRendered.current.has(`${d.name}.${d.type}`)
    )
    if (pending.length === 0) return
    const next = pending[0]
    autoRendered.current.add(`${next.name}.${next.type}`)
    void render(next)
  }, [status, worktreePath, render])

  const diagrams = status?.diagrams ?? []

  return (
    <div className="flex flex-col gap-3">
      {/* Meshy's key lives on the Toolkit page now; it used to also sit here,
          which is why it looked like it was set up twice. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-medium">
            {translate('planide.archify.title', 'Diagrams')}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {status?.available === false
              ? translate('planide.archify.unavailable', 'Archify is not deployed yet.')
              : translate(
                  'planide.archify.hint',
                  'Ask an agent for a diagram; it appears here and renders itself.'
                )}
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
                  <button
                    type="button"
                    onClick={() => void openGraphWindow(d.html as string, d.name)}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink size={11} />
                    {translate('planide.archify.open', 'Open')}
                  </button>
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
