/**
 * GitHub, from inside the tracker.
 *
 * The engine has had all of this since the first version — status, init, remote,
 * a large-file scan, LFS tracking, commit and push with backoff — but until now
 * only the CLI could reach it. This is that half of the project, with a face:
 * see the state of the repo, deal with files too big for git, and push, without
 * leaving the page you were already looking at.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { CloudUpload, GitBranch, HardDrive, Loader2, RefreshCw, Search, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  gitAutoPush,
  gitInit,
  gitLargeFiles,
  gitLfs,
  gitSetRemote,
  gitStatus,
  gitSync,
  withVisibleSpin,
  type GitStatus,
  type LargeFileScan
} from '../right-sidebar/planide-engine-client'

function Card({
  title,
  icon: Icon,
  children,
  action
}: {
  title: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card/40 p-3.5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={13} className="text-muted-foreground" />
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

export default function PlanIdeSync({
  path,
  autoPush,
  lastSync,
  onProject
}: {
  path: string
  autoPush: boolean
  lastSync: string
  onProject: (project: unknown) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [scan, setScan] = useState<LargeFileScan | null>(null)
  const [remote, setRemote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const refresh = useCallback(async () => {
    try {
      setStatus(await gitStatus(path))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }, [path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Every button here is slow enough to need a spinner and a name. */
  const run = useCallback(
    async (name: string, fn: () => Promise<unknown>) => {
      setBusy(name)
      try {
        await fn()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(null)
        void refresh()
      }
    },
    [refresh]
  )

  const dirty = status?.changed_count ?? 0

  return (
    <div className="flex flex-col gap-3">
      <Card
        title={translate('planide.sync.repo', 'Repository')}
        icon={GitBranch}
        action={
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => void withVisibleSpin(setRefreshing, refresh)}
            disabled={refreshing}
          >
            <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
          </Button>
        }
      >
        {!status ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="animate-spin" size={13} /> {translate('planide.sync.reading', 'Reading…')}
          </div>
        ) : !status.has_git ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] text-muted-foreground">
              {translate('planide.sync.noRepo', 'This folder is not a git repository yet.')}
            </span>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void run('init', () => gitInit(path))}
            >
              {busy === 'init' ? <Loader2 className="animate-spin" size={12} /> : <GitBranch size={12} />}
              {translate('planide.sync.init', 'Initialise repo')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 font-mono text-[11px]">
                <GitBranch size={11} className="text-violet-400" />
                {status.branch || '—'}
              </span>
              <span className={cn('tabular-nums', dirty ? 'text-amber-500' : 'text-muted-foreground')}>
                {dirty
                  ? `${dirty} ${translate('planide.sync.changed', 'changed')}`
                  : translate('planide.sync.clean', 'clean')}
              </span>
              {(status.ahead ?? 0) > 0 && (
                <span className="text-emerald-500 tabular-nums">↑{status.ahead}</span>
              )}
              {(status.behind ?? 0) > 0 && (
                <span className="text-amber-500 tabular-nums">↓{status.behind}</span>
              )}
              {status.last_commit && (
                <span className="min-w-0 truncate text-muted-foreground">· {status.last_commit}</span>
              )}
            </div>

            {status.remote ? (
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {status.remote}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={remote}
                  onChange={(e) => setRemote(e.target.value)}
                  placeholder={translate(
                    'planide.sync.remotePlaceholder',
                    'git@github.com:you/project.git'
                  )}
                  className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-[11px] outline-none focus:border-ring"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!remote.trim() || busy !== null}
                  onClick={() => void run('remote', () => gitSetRemote(path, remote.trim()))}
                >
                  {translate('planide.sync.setRemote', 'Set remote')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        title={translate('planide.sync.largeFiles', 'Large files')}
        icon={HardDrive}
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void run('scan', async () => setScan(await gitLargeFiles(path, 25)))}
          >
            {busy === 'scan' ? <Loader2 className="animate-spin" size={12} /> : <Search size={12} />}
            {translate('planide.sync.scan', 'Scan')}
          </Button>
        }
      >
        {!scan ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {translate(
              'planide.sync.scanHint',
              'GitHub rejects a push containing a file over 100 MB, and warns above 50. Scan for anything over 25 MB before it becomes a problem — ROMs, binaries, captures — and hand them to Git LFS.'
            )}
          </p>
        ) : scan.count === 0 ? (
          <p className="text-[12px] text-emerald-500">
            {translate('planide.sync.scanClean', 'Nothing over')} {scan.threshold_mb} MB.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] text-amber-500">
              {scan.count} {translate('planide.sync.overThreshold', 'file(s) over')} {scan.threshold_mb} MB
            </div>
            <div className="max-h-48 overflow-auto rounded-lg border border-border/60 scrollbar-sleek">
              {scan.files.slice(0, 40).map((f) => (
                <div
                  key={f.path}
                  className="flex items-center gap-3 border-b border-border/40 px-2.5 py-1 text-[11px] last:border-none"
                >
                  <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                    {f.ext}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                    {f.size_mb} MB
                  </span>
                </div>
              ))}
            </div>
            {scan.extensions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {translate('planide.sync.lfsHint', 'Track these with Git LFS:')}
                </span>
                {scan.extensions.map((e) => (
                  <span key={e} className="rounded bg-muted px-1.5 py-px font-mono text-[10px]">
                    *{e}
                  </span>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void run('lfs', async () => {
                      const r = await gitLfs(path, scan.extensions)
                      if (!r.ok) throw new Error(r.error ?? 'git-lfs failed')
                      toast.success(
                        `${translate('planide.sync.lfsTracked', 'Tracking with LFS:')} ${(r.tracked ?? []).join(' ')}`
                      )
                    })
                  }
                >
                  {busy === 'lfs' ? <Loader2 className="animate-spin" size={12} /> : null}
                  {translate('planide.sync.trackLfs', 'Track with LFS')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title={translate('planide.sync.push', 'Commit & push')} icon={CloudUpload}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={translate(
              'planide.sync.messagePlaceholder',
              'PulsarIDE: sync tracker + project state'
            )}
            className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-ring"
          />
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void run('sync', async () => {
                const r = await gitSync(path, { message: message.trim(), push: true })
                setLog(r.log ?? [])
                setMessage('')
                if (r.push_error) toast.error(r.push_error)
                else if (r.pushed) toast.success(translate('planide.sync.pushed', 'Pushed'))
                else if (r.committed)
                  toast.success(translate('planide.sync.committed', 'Committed (no push)'))
                else toast.info(translate('planide.sync.nothing', 'Nothing to commit'))
              })
            }
          >
            {busy === 'sync' ? <Loader2 className="animate-spin" size={12} /> : <CloudUpload size={12} />}
            {translate('planide.sync.commitPush', 'Commit & push')}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {translate(
            'planide.sync.pushHint',
            'Stages everything, commits, and pushes — retrying with backoff if the network drops. The tracker state ships with it, so the board travels with the code.'
          )}
        </p>

        <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-background/40 p-2.5">
          <input
            type="checkbox"
            checked={autoPush}
            className="mt-0.5"
            onChange={(e) =>
              void run('auto', async () => onProject(await gitAutoPush(path, e.target.checked)))
            }
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[12px] font-medium">
              <Zap size={11} className={autoPush ? 'text-emerald-500' : 'text-muted-foreground'} />
              {translate('planide.sync.autoPush', 'Push by itself after changes')}
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              {translate(
                'planide.sync.autoPushHint',
                'A change to the board arms a 90-second timer; when things go quiet, the project and its tracker state are committed and pushed. Every attempt lands in Activity, so a failed one is not silent.'
              )}
              {lastSync && (
                <>
                  {' '}
                  <span className="text-emerald-500">
                    {translate('planide.sync.lastSync', 'Last auto-push:')}{' '}
                    {lastSync.slice(0, 16).replace('T', ' ')}
                  </span>
                </>
              )}
            </span>
          </span>
        </label>
        {log.length > 0 && (
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border/60 bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap scrollbar-sleek">
            {log.join('\n')}
          </pre>
        )}
      </Card>
    </div>
  )
}
