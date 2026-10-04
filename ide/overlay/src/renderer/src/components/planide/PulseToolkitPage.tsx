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
import { Check, Folder, Plug, RefreshCw, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useActiveWorktree } from '@/store/selectors'
import {
  codexChatsCompress,
  codexChatsMeasure,
  codexChatsRestore,
  codexChatsSetAge,
  codexChatsSetEnabled,
  codexChatsStatus,
  eccInstall,
  eccSetEnabled,
  eccStatus,
  hookDoctor,
  hookTest,
  hookTurnOff,
  pickFolder,
  quotaResumeCancel,
  quotaResumeSetEnabled,
  quotaResumeStatus,
  rtkStatus,
  trackerHealth,
  trackerRepair,
  unrealInstall,
  unrealSetPath,
  unrealStatus,
  withVisibleSpin,
  type ChatsMeasure,
  type ChatsStatus,
  type EccStatus,
  type HookDoctorReport,
  type HookTest,
  type QuotaResumeStatus,
  type RtkStatus,
  type TrackerHealth,
  type UnrealStatus
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
  qwen: 'todo_write'
}

/** Why a compression run left a chat as it was, in words. */
const CHATS_SKIP: Record<string, string> = {
  'linked-elsewhere': 'also linked outside the Codex homes',
  'has-zst': 'already have a compressed copy beside them',
  'no-space': 'waiting for free disk space',
  changed: 'were written to while being compressed'
}

/** Bytes as people read them on a disk: GB above one, MB below. */
function size(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
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
  // A folder the user picked explicitly wins over the active worktree, so the
  // Toolkit can be pointed at the project whose agents you want checked.
  const [chosen, setChosen] = useState<string>('')
  const folder = chosen || worktreePath
  const [health, setHealth] = useState<TrackerHealth | null>(null)
  const [ecc, setEcc] = useState<EccStatus | null>(null)
  const [unreal, setUnreal] = useState<UnrealStatus | null>(null)
  const [rtk, setRtk] = useState<RtkStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [hooks, setHooks] = useState<HookDoctorReport | null>(null)
  // Each Codex hook run once as Codex runs it -- only when asked.
  const [hookRuns, setHookRuns] = useState<HookTest[] | null>(null)
  const [hookBusy, setHookBusy] = useState(false)
  const [resume, setResume] = useState<QuotaResumeStatus | null>(null)
  const [chats, setChats] = useState<ChatsStatus | null>(null)
  const [chatsSize, setChatsSize] = useState<ChatsMeasure | null>(null)
  // Its own flag: a compression pass can run for minutes, and the rest of the
  // page must stay usable meanwhile.
  const [chatsBusy, setChatsBusy] = useState(false)

  const load = useCallback(async () => {
    // Both are best-effort: one backend hiccup must not blank the whole page.
    await Promise.allSettled([
      trackerHealth(folder || undefined).then(setHealth),
      eccStatus().then(setEcc),
      unrealStatus().then(setUnreal),
      rtkStatus().then(setRtk),
      hookDoctor().then(setHooks),
      quotaResumeStatus().then(setResume),
      codexChatsStatus().then(setChats)
    ])
  }, [folder])

  // Walks every transcript, so it runs on its own and never holds up the page.
  const measureChats = useCallback(async () => {
    try {
      setChatsSize(await codexChatsMeasure())
    } catch {
      setChatsSize(null)
    }
  }, [])

  useEffect(() => {
    void measureChats()
  }, [measureChats])

  // A run started by the daily timer or by Compress now goes on in the
  // background; while it does, follow it instead of showing a stale line.
  useEffect(() => {
    if (!chats?.running) return
    const timer = setInterval(() => {
      void codexChatsStatus().then((next) => {
        setChats(next)
        if (!next.running) void measureChats()
      })
    }, 5000)
    return () => clearInterval(timer)
  }, [chats?.running, measureChats])

  // A resume waits for hours: follow it while one is pending.
  useEffect(() => {
    if (!resume?.pending.length) return
    const timer = setInterval(() => void quotaResumeStatus().then(setResume), 30_000)
    return () => clearInterval(timer)
  }, [resume?.pending.length])

  const runHookTest = useCallback(
    () =>
      withVisibleSpin(setHookBusy, async () => {
        setHookRuns(await hookTest())
        setHooks(await hookDoctor())
      }),
    []
  )

  const turnOffHook = useCallback(
    (run: HookTest) =>
      withVisibleSpin(setHookBusy, async () => {
        await hookTurnOff({ file: run.file, event: run.event, command: run.command })
        setHookRuns(await hookTest())
        setHooks(await hookDoctor())
      }),
    []
  )

  const chatsAction = useCallback(
    (action: 'on' | 'off' | 'compress' | 'restore') =>
      withVisibleSpin(setChatsBusy, async () => {
        if (action === 'on' || action === 'off') await codexChatsSetEnabled(action === 'on')
        if (action === 'compress') await codexChatsCompress()
        if (action === 'restore') await codexChatsRestore()
        setChats(await codexChatsStatus())
        await measureChats()
      }),
    [measureChats]
  )

  const choose = useCallback(
    () =>
      withVisibleSpin(setBusy, async () => {
        const picked = await pickFolder()
        if (picked) setChosen(picked)
      }),
    []
  )

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
        // Turning it on also fetches it now. Without this the button only wrote
        // a preference and nothing visibly happened until the IDE restarted.
        setEcc(enabled ? await eccInstall() : await eccStatus())
      }),
    []
  )

  // You choose where it goes, the IDE downloads it there. Asking the user to
  // clone a repo by hand for a feature the IDE offers was the wrong half of the
  // job to hand back.
  const chooseUnreal = useCallback(
    () =>
      withVisibleSpin(setBusy, async () => {
        const picked = await pickFolder()
        if (picked) setUnreal(await unrealInstall(picked))
      }),
    []
  )
  const clearUnreal = useCallback(
    () => withVisibleSpin(setBusy, async () => setUnreal(await unrealSetPath(''))),
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
          {/* --- which project the checks below run against ------------------ */}
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-3 py-2">
            <Folder size={14} className="shrink-0 text-primary/80" strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted-foreground">
                {translate('planide.toolkit.folderLabel', 'Checking this project')}
              </div>
              <div className="truncate font-mono text-[11px]">
                {folder || translate('planide.toolkit.noFolder', 'no project open')}
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void choose()}>
              {translate('planide.toolkit.choose', 'Choose folder…')}
            </Button>
          </div>
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
                    {a.configExists && !a.readable && (
                      // Repair cannot write a file it cannot parse, and saying
                      // nothing is what made the button look dead.
                      <span className="ml-1 text-amber-500">
                        {' · '}
                        {translate(
                          'planide.toolkit.unreadable',
                          'not valid JSON — left untouched, Repair cannot edit it'
                        )}
                      </span>
                    )}
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

          {/* --- fewer tokens, neither of them anywhere near your login ------ */}
          <Card
            title={translate('planide.toolkit.tokens', 'Fewer tokens')}
            subtitle={translate(
              'planide.toolkit.tokensSub',
              'Both work on your account login — neither needs an API key, and neither sits between an agent and its provider.'
            )}
          >
            <div className="mt-2 flex items-start gap-2 text-[12px]">
              <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <span className="font-medium">caveman</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {translate(
                    'planide.toolkit.caveman',
                    'installed. Writes tersely on /caveman or "be brief" — roughly two thirds off output prose, with code, errors and numbers kept exact.'
                  )}
                </span>
              </div>
            </div>
            <div className="mt-2 flex items-start gap-2 text-[12px]">
              <Dot ok={Boolean(rtk?.installed)} />
              <div className="min-w-0">
                <span className="font-medium">rtk</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {rtk?.installed
                    ? translate('planide.toolkit.rtkOn', 'on PATH') + ` (${rtk.version})` + '. ' +
                      translate(
                        'planide.toolkit.rtkUse',
                        'Agents run noisy commands through it, so less of a build log reaches the context.'
                      )
                    : translate(
                        'planide.toolkit.rtkOff',
                        'not installed. Optional: it filters noisy command output before an agent reads it. Install it yourself — its setup writes a global shell hook, which is your machine to change, not ours.'
                      )}
                </span>
              </div>
            </div>
            {!rtk?.installed && (
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                brew install rtk{'\n'}winget install rtk-ai.rtk
              </pre>
            )}
          </Card>
          {/* --- Unreal: local server, so it needs the folder ---------------- */}
          <Card
            title={translate('planide.toolkit.unreal', 'Unreal Engine')}
            subtitle={translate(
              'planide.toolkit.unrealSub',
              'Drives a running Unreal editor, so it only does anything on a machine with Unreal installed. Pick a folder and the IDE downloads the server into it.'
            )}
          >
            {unreal?.configured ? (
              <>
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <Dot ok={unreal.ready} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{unreal.path}</span>
                </div>
                {unreal.problem && (
                  <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-500">
                    {unreal.problem}
                  </p>
                )}
                {unreal.ready && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {translate(
                      'planide.toolkit.unrealNeeds',
                      'Registered for every agent. Two things stay yours: uv on PATH, and the UnrealMCP plugin enabled in your project.'
                    )}
                  </p>
                )}
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy} onClick={() => void chooseUnreal()}>
                    {translate('planide.toolkit.changeFolder', 'Change folder…')}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy} onClick={() => void clearUnreal()}>
                    {translate('planide.toolkit.clear', 'Clear')}
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" disabled={busy} onClick={() => void chooseUnreal()}>
                <Folder size={12} className="mr-1" />
                {translate('planide.toolkit.unrealChoose', 'Choose a folder and install…')}
              </Button>
            )}
          </Card>

          {/* --- ECC: on disk, reached through tools, not loaded per session -- */}
          <Card
            title={translate('planide.toolkit.ecc', 'ECC')}
            subtitle={translate(
              'planide.toolkit.eccSub',
              "291 skills and 68 agents, shipped with the IDE and searched through ecc_find / ecc_read -- no git, no network, no npx. Installing it as a plugin instead would cost ~40,600 tokens in every session on every project -- measured, not estimated -- so it is not loaded, it is looked up."
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

          {/* --- Auto-resume: "ga door" when the usage limit resets --------- */}
          <Card
            title={translate('planide.toolkit.resume', 'Auto-resume after a usage limit')}
            subtitle={translate(
              'planide.toolkit.resumeSub',
              'When Codex, Gemini CLI, Qwen Code or another agent stops on "usage limit ... try again at 3:45 PM", PulsarIDE types "ga door" into that pane one minute after the reset, so the chat goes on with its own item. Not when you typed in that pane meanwhile, and at most three times in a row. Claude Code does this itself.'
            )}
          >
            {resume ? (
              <div className="mt-2 space-y-1.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <Dot ok={resume.enabled} />
                  <span>
                    {resume.enabled
                      ? translate('planide.toolkit.resumeOn', 'On')
                      : translate('planide.toolkit.resumeOff', 'Off')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => void quotaResumeSetEnabled(!resume.enabled).then(setResume)}
                  >
                    {resume.enabled
                      ? translate('planide.toolkit.eccDisable', 'Turn off')
                      : translate('planide.toolkit.resumeEnable', 'Turn on')}
                  </Button>
                </div>
                {resume.pending.map((p) => (
                  <div key={p.ptyId} className="flex items-center gap-2 text-[11px]">
                    <span className="font-medium">{p.agent}</span>
                    <span className="text-muted-foreground">
                      {translate('planide.toolkit.resumeAt', 'resumes at')}{' '}
                      {new Date(p.fireAt).toLocaleString(undefined, {
                        weekday: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[11px]"
                      onClick={() => void quotaResumeCancel(p.ptyId).then(setResume)}
                    >
                      {translate('planide.toolkit.resumeCancel', 'Cancel')}
                    </Button>
                  </div>
                ))}
                {resume.recent.length > 0 && (
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {resume.recent
                      .slice(-4)
                      .reverse()
                      .map((e, i) => (
                        <li key={`${e.at}-${i}`} className="truncate" title={e.detail}>
                          {new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} ·{' '}
                          {e.agent} · {e.event} · {e.detail}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate('planide.toolkit.checking', 'Checking...')}
              </p>
            )}
          </Card>

          {/* --- Agent hooks: the ones that can never run ------------------- */}
          <Card
            title={translate('planide.toolkit.hooks', 'Agent hooks')}
            subtitle={translate(
              'planide.toolkit.hooksSub',
              "Every hook in Codex, Claude Code, Gemini CLI and Qwen Code is read on launch -- never run. One pointing at a script that is no longer on disk fails on every prompt (Codex: 'Hook failed, exit code 1'), so it is taken out of action: removed, or in Codex kept in its place doing nothing, so your other hooks stay trusted. The config is backed up first."
            )}
          >
            {hooks ? (
              hooks.issues.length === 0 ? (
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <Dot ok />
                  <span>
                    {hooks.checked} {translate('planide.toolkit.hooksOk', 'hooks checked -- none broken')}
                  </span>
                </div>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {hooks.issues.map((issue, i) => (
                    <li key={`${issue.file}-${issue.event}-${i}`} className="text-[11px]">
                      <div className="flex items-center gap-2">
                        <Dot ok={issue.disabled} />
                        <span className="font-medium">
                          {issue.agent} · {issue.event}
                        </span>
                        <span className="text-muted-foreground">
                          {issue.disabled
                            ? translate('planide.toolkit.hookDisabled', 'taken out of action')
                            : translate('planide.toolkit.hookReported', 'reported -- check it')}
                        </span>
                      </div>
                      <p className="ml-5 truncate text-muted-foreground" title={issue.command}>
                        {issue.problem}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate('planide.toolkit.checking', 'Checking...')}
              </p>
            )}
            {/* Codex says "hook exited with code 1" and names no hook: run each
                one the way Codex does and show which. */}
            <div className="mt-3 border-t border-border/40 pt-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium">
                  {translate('planide.toolkit.codexHooks', 'Codex hooks')}
                  {hooks?.codex ? ` (${hooks.codex.length})` : ''}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={hookBusy}
                  onClick={() => void runHookTest()}
                >
                  {hookBusy
                    ? translate('planide.toolkit.hookTesting', 'Testing...')
                    : translate('planide.toolkit.hookTest', 'Test hooks')}
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {translate(
                  'planide.toolkit.hookTestSub',
                  'Runs each Codex hook once the way Codex does (PowerShell on Windows), with a harmless shell call in an empty folder, and shows which one fails.'
                )}
              </p>
              {(hookRuns ?? hooks?.codex ?? []).length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {(hookRuns ?? hooks?.codex ?? []).map((entry, i) => {
                    const run = hookRuns ? (entry as HookTest) : null
                    return (
                      <li key={`${entry.file}-${entry.event}-${i}`} className="text-[11px]">
                        <div className="flex items-center gap-2">
                          {run ? <Dot ok={run.ok} /> : <span className="w-[13px] shrink-0" />}
                          <span className="font-medium">
                            {entry.event}
                            {entry.matcher ? ` · ${entry.matcher}` : ''}
                          </span>
                          <span className="text-muted-foreground">
                            {entry.ours
                              ? 'PulsarIDE'
                              : entry.command === 'exit 0'
                                ? translate('planide.toolkit.hookOff', 'turned off')
                                : translate('planide.toolkit.hookOther', 'other')}
                          </span>
                          {run && !run.ok && (
                            <span className="text-amber-500">
                              {run.code === null
                                ? translate('planide.toolkit.hookNoExit', 'did not finish')
                                : `exit ${run.code}`}
                            </span>
                          )}
                          {run && !run.ok && !entry.ours && entry.command !== 'exit 0' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1.5 text-[11px]"
                              disabled={hookBusy}
                              onClick={() => void turnOffHook(run)}
                            >
                              {translate('planide.toolkit.hookTurnOff', 'Turn off')}
                            </Button>
                          )}
                        </div>
                        <p className="ml-5 truncate font-mono text-muted-foreground" title={`${entry.file}\n${entry.command}`}>
                          {entry.command}
                        </p>
                        {run && !run.ok && run.output && (
                          <p className="ml-5 break-words text-amber-500/90">{run.output}</p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Card>

          {/* --- Codex chats: compressed losslessly, never deleted ------------ */}
          <Card
            title={translate('planide.toolkit.chats', 'Codex chats (storage)')}
            subtitle={translate(
              'planide.toolkit.chatsSub',
              'Chats nobody touched for a while are compressed with zstd -- the format Codex reads itself, so `codex resume` still opens every one of them. Lossless: checked byte for byte before the original goes. Explorer counts each chat once per account folder; the disk holds it once.'
            )}
          >
            {chatsSize ? (
              <div className="mt-2 space-y-1 text-[12px]">
                <div className="flex items-center gap-2">
                  <Dot ok={chatsSize.coldPlainBytes < 1024 ** 3 && !chats?.lastReport?.partial} />
                  <span>
                    {translate('planide.toolkit.chatsDisk', 'On disk')} {size(chatsSize.physicalBytes)}
                    <span className="text-muted-foreground">
                      {' '}
                      · {translate('planide.toolkit.chatsExplorer', 'Explorer shows')} {size(chatsSize.logicalBytes)}
                    </span>
                  </span>
                </div>
                {/* Where the on-disk total sits: most of what is left is usually
                    chats still in use, which are compressed once they go quiet. */}
                <p className="text-[11px] text-muted-foreground">
                  {chatsSize.compressedChats} {translate('planide.toolkit.chatsCompressed', 'compressed')}
                  {chatsSize.compressedBytes !== undefined ? ` (${size(chatsSize.compressedBytes)})` : ''} ·{' '}
                  {chatsSize.recentPlainBytes !== undefined
                    ? `${size(chatsSize.recentPlainBytes)} ${translate('planide.toolkit.chatsRecentPre', 'in chats from the last')} ${chats?.minAgeDays ?? 30} ${translate('planide.toolkit.chatsRecentPost', 'days (in use)')} · `
                    : ''}
                  {size(chatsSize.coldPlainBytes)} {translate('planide.toolkit.chatsCold', 'still to compress')}
                  {chatsSize.linkedElsewhereBytes
                    ? ` · ${size(chatsSize.linkedElsewhereBytes)} ${translate('planide.toolkit.chatsElsewhere', 'also linked outside the Codex homes, left alone')}`
                    : ''}
                </p>
                {/* Which apps' chats were found: Orca's are compressed the same
                    way when Orca is (or was) on this machine. */}
                {chatsSize.sources && chatsSize.sources.length > 0 && (
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {chatsSize.sources.map((s) => (
                      <li key={s.base} className="truncate" title={s.base}>
                        <span className="font-medium text-foreground">{s.app}</span> · {s.chats}{' '}
                        {translate('planide.toolkit.chatsChats', 'chats')} · {size(s.bytes)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {translate('planide.toolkit.chatsMeasuring', 'Measuring...')}
              </p>
            )}
            {chats && (
              <>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {chats.running || chatsBusy
                    ? translate('planide.toolkit.chatsRunning', 'Compressing now...')
                    : chats.lastReport?.partial
                      ? `${translate('planide.toolkit.chatsPaused', 'Paused after 30 minutes -- the next run, or Compress now, carries on.')} ${translate('planide.toolkit.chatsFreed', 'Freed so far')} ${size(chats.totalFreed)}`
                      : chats.lastRun
                      ? `${translate('planide.toolkit.chatsFreed', 'Freed so far')} ${size(chats.totalFreed)} · ${chats.totalDone} ${translate('planide.toolkit.chatsChats', 'chats')}`
                      : chats.enabled
                        ? translate('planide.toolkit.chatsFirst', 'First run ten minutes after launch, then daily.')
                        : translate('planide.toolkit.chatsOffNote', 'Automatic compression is off.')}
                </p>
                {chats.lastReport && Object.keys(chats.lastReport.skippedWhy ?? {}).length ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {translate('planide.toolkit.chatsLeft', 'Left as they were last run:')}{' '}
                    {Object.entries(chats.lastReport.skippedWhy ?? {})
                      .map(([why, n]) => `${n} ${CHATS_SKIP[why] ?? why}`)
                      .join(' · ')}
                  </p>
                ) : null}
                {chats.lastReport?.failed ? (
                  <p className="mt-1 truncate text-[11px] text-amber-500" title={chats.lastReport.errors.join('\n')}>
                    {chats.lastReport.failed} {translate('planide.toolkit.chatsFailed', 'could not be compressed -- left as they were')}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={chatsBusy}
                    onClick={() => void chatsAction(chats.enabled ? 'off' : 'on')}
                  >
                    {chats.enabled
                      ? translate('planide.toolkit.chatsAutoOn', 'Automatic: on')
                      : translate('planide.toolkit.chatsAutoOff', 'Automatic: off')}
                  </Button>
                  {/* After how long a chat counts as quiet. Shorter frees more now;
                      Orca's own chat search does not read compressed chats. */}
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {translate('planide.toolkit.chatsAfter', 'after')}
                    {[7, 14, 30].map((days) => (
                      <Button
                        key={days}
                        size="sm"
                        variant={(chats.minAgeDays ?? 30) === days ? 'secondary' : 'ghost'}
                        className="h-7 px-2 text-[11px]"
                        disabled={chatsBusy}
                        onClick={() =>
                          void withVisibleSpin(setChatsBusy, async () => {
                            setChats({ ...(await codexChatsSetAge(days)), running: chats.running })
                            await measureChats()
                          })
                        }
                      >
                        {days} {translate('planide.toolkit.chatsDays', 'days')}
                      </Button>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={chatsBusy || chats.running}
                    onClick={() => void chatsAction('compress')}
                  >
                    {translate('planide.toolkit.chatsNow', 'Compress now')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] text-muted-foreground"
                    disabled={chatsBusy || chats.running}
                    onClick={() => {
                      if (
                        window.confirm(
                          translate(
                            'planide.toolkit.chatsRestoreAsk',
                            'Turn every compressed chat back into a plain file? This needs the full size again on disk.'
                          )
                        )
                      ) {
                        void chatsAction('restore')
                      }
                    }}
                  >
                    {translate('planide.toolkit.chatsRestore', 'Restore all')}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
