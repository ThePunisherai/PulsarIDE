/**
 * Toolkit: everything this IDE wires into your agents, and whether it arrived.
 *
 * This page exists because of a specific, repeated complaint: features were
 * shipped, the release notes said so, and there was nowhere in the app to see
 * that any of it was real. Meshy was a key field buried in the Archify tab, ECC
 * had no surface at all, and whether a given agent could actually reach the
 * board was only visible in a banner that appears when something is already
 * wrong. "I don't see it anywhere" was an accurate description of the UI.
 *
 * So the rule here is that nothing on this page is a claim. Every line is read
 * back from the machine: which config file each agent keeps, whether our server
 * is named in it, and -- for the tracker -- the result of actually launching the
 * registered command and asking it for its tool list. A row that says it works
 * has been checked, not assumed.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Check, Plug, RefreshCw, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import {
  eccSetEnabled,
  eccStatus,
  trackerHealth,
  trackerRepair,
  withVisibleSpin,
  type EccStatus,
  type TrackerHealth
} from '../right-sidebar/planide-engine-client'
import { MeshyKey } from './PulseArchify'

/**
 * Which agents keep their plan on the board without being asked.
 *
 * Four have a real hook on their own plan tool, so the harness does it. The rest
 * only get there when the agent calls sync_plan, which is a thing a model can
 * skip -- and this is the honest place to say which is which, rather than
 * implying it is automatic everywhere.
 */
const PLAN_HOOKS: Record<string, string> = {
  'claude-code': 'TodoWrite',
  codex: 'update_plan',
  gemini: 'write_todos',
  qwen: 'write_todos'
}

function Dot({ ok }: { ok: boolean }): React.JSX.Element {
  return ok ? (
    <Check size={13} className="shrink-0 text-emerald-500" />
  ) : (
    <X size={13} className="shrink-0 text-amber-500" />
  )
}

function Card({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border/40 bg-card/40 px-4 py-3">
      <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  )
}

export default function PulseToolkitPage(): React.JSX.Element {
  const worktree = useActiveWorktree()
  const worktreePath = worktree?.path ?? ''
  const [health, setHealth] = useState<TrackerHealth | null>(null)
  const [ecc, setEcc] = useState<EccStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    // Both are best-effort: one backend hiccup must not blank the whole page.
    await Promise.allSettled([
      trackerHealth(worktreePath || undefined).then(setHealth),
      eccStatus().then(setEcc)
    ])
  }, [worktreePath])

  useEffect(() => {
    void load()
  }, [load])

  // withVisibleSpin owns the flag: it holds the spinner long enough to be seen
  // even when the call returns instantly, which is the normal case here.
  const refresh = useCallback(() => withVisibleSpin(setBusy, load), [load])

  const repair = useCallback(
    () =>
      withVisibleSpin(setBusy, async () => {
        await trackerRepair()
        await load()
      }),
    [load]
  )

  const toggleEcc = useCallback(
    (enabled: boolean) =>
      withVisibleSpin(setBusy, async () => {
        await eccSetEnabled(enabled)
        setEcc(await eccStatus())
      }),
    []
  )

  const wired = health?.agents.filter((a) => a.registered).length ?? 0
  const total = health?.agents.length ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-sleek">
      <header className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <Wrench className="size-5 shrink-0 text-primary" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">
            {translate('planide.nav.toolkit', 'Toolkit')}
          </h1>
          <p className="truncate text-[12px] text-muted-foreground">
            {translate(
              'planide.toolkit.subtitle',
              'Every server, hook and library this IDE wires into your agents -- read back from your machine, not claimed.'
            )}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={12} className={cn('mr-1', busy && 'animate-spin')} />
          {translate('planide.toolkit.refresh', 'Re-check')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 p-6">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {/* --- the tracker server, actually launched ----------------------- */}
          <Card
            title={translate('planide.toolkit.tracker', 'Tracker server (planide)')}
            subtitle={translate(
              'planide.toolkit.trackerSub',
              'The board your agents read and write. This row is the result of launching it, not of finding the file.'
            )}
          >
            {health ? (
              <>
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <Dot ok={health.serverRuns} />
                  <span>
                    {health.serverRuns
                      ? translate('planide.toolkit.runs', 'Starts and answers') +
                        ` · ${health.toolCount} ` +
                        translate('planide.toolkit.tools', 'tools')
                      : translate('planide.toolkit.dead', 'Did not answer when launched')}
                  </span>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                  {health.command} {health.args.join(' ')}
                </pre>
                {health.problem && (
                  <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-500">
                    {health.problem}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate('planide.toolkit.checking', 'Checking...')}
              </p>
            )}
          </Card>

          {/* --- per agent: config file, wired, automatic plan sync ---------- */}
          <Card
            title={
              translate('planide.toolkit.agents', 'Your agents') +
              (total ? ` · ${wired}/${total}` : '')
            }
            subtitle={translate(
              'planide.toolkit.agentsSub',
              'Each reads its own config file. A plan hook means the agent keeps the board current by itself; the rest rely on it calling sync_plan.'
            )}
          >
            <div className="mt-2 space-y-1">
              {(health?.agents ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-[12px]">
                  <Dot ok={a.registered} />
                  <span className="w-28 shrink-0 font-medium">{a.label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                    {a.configPath}
                  </span>
                  {PLAN_HOOKS[a.id] ? (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-semibold text-emerald-500">
                      {PLAN_HOOKS[a.id]}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-px text-[9px] text-muted-foreground">
                      sync_plan
                    </span>
                  )}
                </div>
              ))}
              {health && wired < total && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 w-full text-[11px]"
                  disabled={busy}
                  onClick={() => void repair()}
                >
                  <Plug size={12} className="mr-1" />
                  {translate('planide.toolkit.repair', 'Wire the missing ones')}
                </Button>
              )}
            </div>
          </Card>

          {/* --- Meshy: the key IS the switch -------------------------------- */}
          <Card
            title={translate('planide.toolkit.meshy', 'Meshy 3D')}
            subtitle={translate(
              'planide.toolkit.meshySub',
              'A paid API, so it cannot ship switched on: with no key its server exits and every agent shows a broken tool. Saving a key registers it for all of them at once.'
            )}
          >
            <div className="mt-2">
              <MeshyKey />
            </div>
          </Card>

          {/* --- ECC: on disk, reached through tools, not loaded per session -- */}
          <Card
            title={translate('planide.toolkit.ecc', 'ECC')}
            subtitle={translate(
              'planide.toolkit.eccSub',
              "286 skills and 68 agents, kept on disk and searched through ecc_find / ecc_read. Installing it as a plugin instead would cost ~40,600 tokens in every session on every project -- measured, not estimated -- so it is not loaded, it is looked up."
            )}
          >
            {ecc ? (
              <>
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <Dot ok={ecc.installed} />
                  <span>
                    {ecc.installed
                      ? translate('planide.toolkit.eccOn', 'Catalogue on disk') +
                        ` · ${ecc.alwaysOnTokens} ` +
                        translate('planide.toolkit.eccCost', 'tokens per session')
                      : ecc.optedOut
                        ? translate('planide.toolkit.eccOff', 'Turned off')
                        : translate('planide.toolkit.eccPending', 'Not fetched yet')}
                  </span>
                </div>
                {ecc.lastError && (
                  <p className="mt-1 truncate text-[11px] text-amber-500" title={ecc.lastError}>
                    {ecc.lastError}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-[11px]"
                  disabled={busy}
                  onClick={() => void toggleEcc(ecc.optedOut)}
                >
                  {ecc.optedOut
                    ? translate('planide.toolkit.eccEnable', 'Turn on')
                    : translate('planide.toolkit.eccDisable', 'Turn off')}
                </Button>
              </>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate('planide.toolkit.checking', 'Checking...')}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
