/**
 * PlanIDE tracker bridge -- the contract, not the wiring.
 *
 * Upstream declares every preload surface as a type under src/preload/api/ and
 * implements it in a separate bridge module (gitlab-api.ts vs gl-bridge.ts).
 * The split is not cosmetic: api-types.ts is compiled into the RENDERER project
 * as well as the preload one, and that project's file list covers this
 * directory but not the bridge implementations -- which import electron. So the
 * contract has to live here, free of any runtime import, or PreloadApi cannot
 * name it at all.
 *
 * src/preload/planide.ts satisfies this type, so the two stay in step: a method
 * added to the bridge, dropped from here, or given an argument of a different
 * type is a compile error rather than a surprise at runtime. (Declaring an
 * argument here that the bridge does not take is not -- TypeScript lets a
 * shorter function satisfy a longer signature -- but that direction is inert,
 * since the extra argument would simply never be read.)
 */

/** Every tracker channel answers with this: never throws across IPC. */
export type PlanIdeReply<T> = { ok: boolean; data?: T; error?: string }

type Call<T> = Promise<PlanIdeReply<T>>

export type PlanIdeApi = {
  // project
  open: <T>(path: string) => Call<T>
  detect: <T>(path: string) => Call<T>
  redetect: <T>(path: string) => Call<T>
  setCustomStack: <T>(path: string, custom: string) => Call<T>

  // items
  addItem: <T>(path: string, opts: unknown) => Call<T>
  updateItem: <T>(path: string, itemId: string, fields: unknown) => Call<T>
  deleteItem: <T>(path: string, itemId: string) => Call<T>
  /** Yours alone -- no agent-facing surface reaches this. */
  verifyItem: <T>(path: string, itemId: string, verified: boolean) => Call<T>
  /** Yours alone -- an agent must not unprotect what it is about to rewrite. */
  lockItem: <T>(path: string, itemId: string, locked: boolean) => Call<T>

  // fixes
  addFix: <T>(path: string, opts: unknown) => Call<T>
  updateFix: <T>(path: string, fixId: string, fields: unknown) => Call<T>
  deleteFix: <T>(path: string, fixId: string) => Call<T>

  // roadmap + versions
  addMilestone: <T>(path: string, title: string, target: string) => Call<T>
  updateMilestone: <T>(path: string, mid: string, fields: unknown) => Call<T>
  deleteMilestone: <T>(path: string, mid: string) => Call<T>
  addVersion: <T>(path: string, version: string, opts: unknown) => Call<T>

  // briefing
  report: (path: string, mode: string) => Call<string>

  // project memory (graphify graph + Obsidian note status)
  memoryStatus: <T>(path: string) => Call<T>
  history: <T>(path: string, limit?: number) => Call<T>
  graphReport: <T>(path: string) => Call<T>
  graphPicture: <T>(path: string) => Call<T>
  reindexGraph: <T>(path: string) => Call<T>
  openGraphWindow: <T>(htmlPath: string, title?: string) => Call<T>
  openDesignStatus: <T>() => Call<T>
  openDesignConnect: <T>(agents: string[]) => Call<T>
  openDesignLaunch: <T>() => Call<T>
  openDesignInstall: <T>() => Call<T>
  archifyStatus: <T>(path: string) => Call<T>
  archifyRender: <T>(path: string, name: string, type: string) => Call<T>

  /** Live board updates; returns an unsubscribe. */
  onBoardChanged: (listener: (path: string) => void) => () => void

  // git
  gitStatus: <T>(path: string) => Call<T>
  gitInit: <T>(path: string, branch: string) => Call<T>
  gitSetRemote: <T>(path: string, url: string) => Call<T>
  gitLargeFiles: <T>(path: string, mb: number) => Call<T>
  gitLfs: <T>(path: string, patterns: string[]) => Call<T>
  gitSync: <T>(path: string, opts: unknown) => Call<T>
  gitAutoPush: <T>(path: string, enabled: boolean) => Call<T>

  // backups
  backupCreate: <T>(path: string, label: string) => Call<T>
  backupList: <T>(path: string) => Call<T>
  backupDelete: <T>(path: string, file: string) => Call<T>
}
