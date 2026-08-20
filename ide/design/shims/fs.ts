// In-memory filesystem for the design harness: the real store code runs
// unchanged, it just writes into a Map instead of a disk.
const files = new Map<string, string>()
export function existsSync(p: string): boolean { return files.has(p) }
export function readFileSync(p: string): string { return files.get(p) ?? '' }
export function writeFileSync(p: string, data: string): void { files.set(p, String(data)) }
export function mkdirSync(): void {}
export function renameSync(a: string, b: string): void {
  const v = files.get(a); if (v !== undefined) { files.set(b, v); files.delete(a) }
}
export function readdirSync(): string[] { return [] }
export function statSync(): { size: number; mtimeMs: number; isDirectory: () => boolean } {
  return { size: 0, mtimeMs: Date.now(), isDirectory: () => false }
}
export function rmSync(): void {}
export default { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, rmSync }
