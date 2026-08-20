/**
 * Snapshots of the project, from inside the tracker.
 *
 * `backup.ts` has been able to write these since the first version — a real zip,
 * written without an archive dependency — but nothing in the IDE could ask for
 * one. Now it can: take a snapshot before letting an agent loose on something
 * load-bearing, and see what you already have.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Archive, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  backupCreate,
  backupDelete,
  backupList,
  type BackupInfo
} from '../right-sidebar/planide-engine-client'

export default function PlanIdeBackups({
  path,
  version
}: {
  path: string
  version: string
}): React.JSX.Element {
  const [list, setList] = useState<BackupInfo[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setList(await backupList(path))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setList([])
    }
  }, [path])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(async () => {
    setBusy(true)
    try {
      const r = await backupCreate(path, label.trim())
      if (!r.ok) throw new Error(r.error ?? 'backup failed')
      toast.success(`${r.file} — ${r.files} ${translate('planide.backups.files', 'files')}, ${r.size_mb} MB`)
      setLabel('')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [path, label, refresh])

  const total = (list ?? []).reduce((sum, b) => sum + b.size_mb, 0)

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-border bg-card/40 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && void create()}
            placeholder={translate(
              'planide.backups.labelPlaceholder',
              'label (optional) — e.g. before-audio-rewrite'
            )}
            className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-ring"
          />
          <Button size="sm" disabled={busy} onClick={() => void create()}>
            {busy ? <Loader2 className="animate-spin" size={12} /> : <Archive size={12} />}
            {translate('planide.backups.create', 'Take snapshot')}
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {translate(
            'planide.backups.hint',
            'A zip of the project as it is now, including the tracker state, next to it in .planide/backups. node_modules, .git, build output and the snapshots themselves are left out, so it stays small.'
          )}{' '}
          {version && (
            <span className="text-muted-foreground/70">
              {translate('planide.backups.stamped', 'Stamped with the current version, v')}
              {version}.
            </span>
          )}
        </p>
      </section>

      {list === null ? (
        <div className="flex items-center gap-2 p-2 text-[12px] text-muted-foreground">
          <Loader2 className="animate-spin" size={13} /> {translate('planide.backups.reading', 'Reading…')}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
          {translate('planide.backups.empty', 'No snapshots yet.')}
        </div>
      ) : (
        <section className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-card/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {list.length} {translate('planide.backups.snapshots', 'snapshots')}
            <span className="ml-auto tabular-nums">{Math.round(total * 10) / 10} MB</span>
          </div>
          {list.map((b) => (
            <div
              key={b.file}
              className="group flex items-center gap-3 border-b border-border/40 px-3 py-2 text-[12px] last:border-none hover:bg-accent/40"
            >
              <Archive size={12} className="shrink-0 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{b.file}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {b.created_at}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                {b.size_mb} MB
              </span>
              <button
                type="button"
                aria-label={translate('planide.backups.delete', 'Delete snapshot')}
                onClick={() => {
                  if (!window.confirm(`${translate('planide.backups.deleteConfirm', 'Delete')} ${b.file}?`))
                    return
                  void backupDelete(path, b.file)
                    .then(refresh)
                    .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
                }}
                className="shrink-0 text-muted-foreground/40 transition-colors can-hover:opacity-0 can-hover:group-hover:opacity-100 hover:text-rose-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
