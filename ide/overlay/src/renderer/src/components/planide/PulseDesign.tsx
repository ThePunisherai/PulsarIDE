/**
 * OpenDesign, as a right-sidebar tab.
 *
 * OpenDesign turns a coding agent into a design engine, and reaches agents over
 * MCP -- so wiring it once gives Claude Code, Codex, Cursor and the rest the
 * same design tooling. This panel does three things and nothing more: report
 * whether `od` is actually installed, list the projects it knows about, and run
 * OpenDesign's own `od mcp install <agent>` when you ask it to.
 *
 * It never installs OpenDesign and never writes an agent config itself. The
 * connect button runs the vendor's documented command and shows the vendor's
 * own output, including failures -- an agent OpenDesign does not support fails
 * visibly here rather than being quietly dropped.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { ExternalLink, PenTool, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  openDesignConnect,
  openDesignLaunch,
  openDesignStatus,
  type ConnectResult,
  type OpenDesignStatus,
  withVisibleSpin
} from '../right-sidebar/planide-engine-client'

/** The agents this IDE deploys Pulse Agent to, in OpenDesign's own naming. */
const AGENTS = ['claude', 'codex', 'cursor']

export function OpenDesignSidebar(): React.JSX.Element {
  const [status, setStatus] = useState<OpenDesignStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [results, setResults] = useState<ConnectResult[] | null>(null)

  const refresh = useCallback(() => {
    void withVisibleSpin(setLoading, async () => {
      try {
        setStatus(await openDesignStatus())
      } catch {
        setStatus(null)
      }
    })
  }, [])

  useEffect(() => refresh(), [refresh])

  const connect = useCallback(() => {
    setConnecting(true)
    setResults(null)
    void openDesignConnect(AGENTS)
      .then(setResults)
      .catch((err: unknown) =>
        setResults([{ agent: 'od', ok: false, output: err instanceof Error ? err.message : String(err) }])
      )
      .finally(() => setConnecting(false))
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 scrollbar-sleek">
      <div className="mb-3 flex items-center gap-2">
        <PenTool size={14} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[12px] font-semibold">
          {translate('planide.design.tab', 'Open Design')}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 shrink-0 px-1.5 text-muted-foreground"
          onClick={refresh}
          disabled={loading}
          aria-label={translate('planide.memory.refresh', 'Refresh')}
        >
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {status && !status.installed && (
        <div className="rounded-xl border border-border/70 bg-card/40 p-3">
          <div className="text-[12px] font-medium">
            {translate('planide.design.missing', 'OpenDesign is not installed')}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {translate(
              'planide.design.missingHint',
              'An open-source design engine your agents can drive: prototypes, dashboards, decks and documents, exported as real HTML, PDF, PPTX or MP4. Install the desktop app, then come back here to connect it to your agents.'
            )}
          </p>
          {/* A real link, not a string to retype. OpenDesign is a separate desktop
              app -- it publishes no npm package, so it genuinely cannot be
              bundled the way the ThreeUI components are -- which makes getting
              there in one click the most this panel can honestly do. */}
          <a
            href="https://open-design.ai"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground/80 underline underline-offset-2 hover:text-foreground"
          >
            open-design.ai
            <ExternalLink size={10} />
          </a>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {translate(
              'planide.design.threeuiHint',
              'For design work that needs nothing installed, 44 ThreeUI components (React + three.js backgrounds, shaders and 3D UI) already ship with PulsarIDE — ask an agent for one and it will adapt it into your project.'
            )}
          </p>
        </div>
      )}

      {status?.installed && (
        <>
          <div className="rounded-xl border border-border/70 bg-card/40 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {translate('planide.design.installed', 'installed')}
              </span>
              {status.version && (
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground/70">
                  {status.version}
                </span>
              )}
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/60">
              {status.binary}
            </div>
          </div>

          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={connect} disabled={connecting}>
              {connecting
                ? translate('planide.design.connecting', 'Connecting…')
                : translate('planide.design.connect', 'Connect to agents')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 px-2 text-muted-foreground"
              onClick={() => void openDesignLaunch()}
              aria-label={translate('planide.design.open', 'Open OpenDesign')}
            >
              <ExternalLink size={12} />
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/70">
            {translate(
              'planide.design.connectHint',
              'Runs OpenDesign’s own `od mcp install` for Claude, Codex and Cursor, so they can all drive it.'
            )}
          </p>

          {results && (
            <div className="mt-2 space-y-1">
              {results.map((r) => (
                <div key={r.agent} className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 shrink-0 rounded-full', r.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
                    <span className="text-[11px] font-medium">{r.agent}</span>
                  </div>
                  {r.output && (
                    <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {r.output.slice(0, 400)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {status.error && (
            <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/5 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-rose-400">
              {status.error}
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {translate('planide.design.projects', 'Projects')}
            </div>
            {status.projects.length === 0 ? (
              <div className="text-[11px] text-muted-foreground/70">
                {translate('planide.design.noProjects', 'No design projects yet.')}
              </div>
            ) : (
              <div className="space-y-1">
                {status.projects.map((p) => (
                  <div key={p.id} className="rounded-lg border border-border/60 bg-card/30 px-2.5 py-1.5">
                    <div className="truncate text-[11.5px]">{p.name}</div>
                    {p.path && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground/60">{p.path}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
