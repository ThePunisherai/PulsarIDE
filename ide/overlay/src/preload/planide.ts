/**
 * PlanIDE tracker bridge (preload).
 *
 * Typed channels straight onto the main-process tracker — no server, no port,
 * no HTTP anywhere in the path, so there is nothing to CORS and nothing extra
 * to run. A project is addressed by its filesystem path; the renderer already
 * knows the active worktree's.
 */

import { ipcRenderer } from 'electron'

type Reply<T> = { ok: boolean; data?: T; error?: string }

const call = <T>(channel: string, ...args: unknown[]): Promise<Reply<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<Reply<T>>

export const planIdeApi = {
  // project
  open: <T>(path: string) => call<T>('planide:open', path),
  detect: <T>(path: string) => call<T>('planide:detect', path),
  redetect: <T>(path: string) => call<T>('planide:redetect', path),
  setCustomStack: <T>(path: string, custom: string) =>
    call<T>('planide:set-custom-stack', path, custom),

  // items
  addItem: <T>(path: string, opts: unknown) => call<T>('planide:item-add', path, opts),
  updateItem: <T>(path: string, itemId: string, fields: unknown) =>
    call<T>('planide:item-update', path, itemId, fields),
  deleteItem: <T>(path: string, itemId: string) => call<T>('planide:item-delete', path, itemId),
  /** Yours alone — no agent-facing surface reaches this. */
  verifyItem: <T>(path: string, itemId: string, verified: boolean) =>
    call<T>('planide:item-verify', path, itemId, verified),
  /** Yours alone — an agent must not unprotect what it is about to rewrite. */
  lockItem: <T>(path: string, itemId: string, locked: boolean) =>
    call<T>('planide:item-lock', path, itemId, locked),

  // fixes
  addFix: <T>(path: string, opts: unknown) => call<T>('planide:fix-add', path, opts),
  updateFix: <T>(path: string, fixId: string, fields: unknown) =>
    call<T>('planide:fix-update', path, fixId, fields),
  deleteFix: <T>(path: string, fixId: string) => call<T>('planide:fix-delete', path, fixId),

  // roadmap + versions
  addMilestone: <T>(path: string, title: string, target: string) =>
    call<T>('planide:milestone-add', path, title, target),
  updateMilestone: <T>(path: string, mid: string, fields: unknown) =>
    call<T>('planide:milestone-update', path, mid, fields),
  deleteMilestone: <T>(path: string, mid: string) => call<T>('planide:milestone-delete', path, mid),
  addVersion: <T>(path: string, version: string, opts: unknown) =>
    call<T>('planide:version-add', path, version, opts),

  // briefing
  report: (path: string, mode: string) => call<string>('planide:report', path, mode),

  // git
  gitStatus: <T>(path: string) => call<T>('planide:git-status', path),
  gitInit: <T>(path: string, branch: string) => call<T>('planide:git-init', path, branch),
  gitSetRemote: <T>(path: string, url: string) => call<T>('planide:git-set-remote', path, url),
  gitLargeFiles: <T>(path: string, mb: number) => call<T>('planide:git-large-files', path, mb),
  gitLfs: <T>(path: string, patterns: string[]) => call<T>('planide:git-lfs', path, patterns),
  gitSync: <T>(path: string, opts: unknown) => call<T>('planide:git-sync', path, opts),

  // backups
  backupCreate: <T>(path: string, label: string) => call<T>('planide:backup-create', path, label),
  backupList: <T>(path: string) => call<T>('planide:backup-list', path),
  backupDelete: <T>(path: string, file: string) => call<T>('planide:backup-delete', path, file)
}
