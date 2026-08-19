/**
 * Zip-snapshot backups of a tracked project.
 *
 * Snapshots land in `<project>/.planide/backups/`. Heavy, regenerable
 * directories (node_modules, .git, venv, target, build, and the backups folder
 * itself) are skipped, so a snapshot stays small and fast.
 *
 * The ZIP is written by hand on top of Node's `zlib`. Orca ships no archive
 * library and this is not worth a new dependency: the format below is the
 * classic one (local header + central directory + EOCD, deflate or stored),
 * which every unzip implementation reads. Only what a backup actually needs is
 * emitted — no zip64, no encryption, no multi-disk.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { SKIP_DIRS } from './detect'

// `.planide` is skipped for *detection* but not here: the tracker state is the
// board itself and belongs in a snapshot. Only the backups folder is excluded,
// so snapshots never nest inside snapshots (see the skipPrefix check below).
const BACKUP_SKIP = new Set([...SKIP_DIRS, '.git'])
BACKUP_SKIP.delete('.planide')

export type BackupInfo = {
  file: string
  size: number
  size_mb: number
  created_at: string
}

export function backupsDir(projectPath: string): string {
  const dir = join(projectPath, '.planide', 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

function collect(projectPath: string): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = []
  const skipPrefix = join('.planide', 'backups')

  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const abs = join(dir, name)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (BACKUP_SKIP.has(name)) continue
        walk(abs)
        continue
      }
      const rel = relative(projectPath, abs)
      // Never back up the backups.
      if (rel.startsWith(skipPrefix)) continue
      out.push({ abs, rel })
    }
  }
  walk(projectPath)
  return out
}

// --- CRC-32 (ZIP's checksum) ------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time, the only timestamp a classic ZIP entry carries. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

function writeZip(target: string, files: { abs: string; rel: string }[]): number {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let written = 0
  const now = dosDateTime(new Date())

  for (const { abs, rel } of files) {
    let raw: Buffer
    try {
      raw = readFileSync(abs)
    } catch {
      continue
    }
    // ZIP paths are always forward-slashed, on every platform.
    const nameBuf = Buffer.from(rel.split(sep).join('/'), 'utf8')
    const crc = crc32(raw)
    const deflated = deflateRawSync(raw)
    // Storing beats deflating when compression made it bigger (tiny/rand files).
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(now.time, 10)
    local.writeUInt16LE(now.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    chunks.push(local, nameBuf, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0) // central directory signature
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0, 8) // flags
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(now.time, 12)
    dir.writeUInt16LE(now.date, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt16LE(0, 30) // extra
    dir.writeUInt16LE(0, 32) // comment
    dir.writeUInt16LE(0, 34) // disk number
    dir.writeUInt16LE(0, 36) // internal attrs
    dir.writeUInt32LE(0, 38) // external attrs
    dir.writeUInt32LE(offset, 42) // offset of local header
    central.push(dir, nameBuf)

    offset += local.length + nameBuf.length + body.length
    written++
  }

  const centralBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // end of central directory
  eocd.writeUInt16LE(0, 4) // disk
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(written, 8)
  eocd.writeUInt16LE(written, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  writeFileSync(target, Buffer.concat([...chunks, centralBuf, eocd]))
  return written
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

export function create(
  projectPath: string,
  version = '',
  label = ''
): { ok: boolean; file?: string; path?: string; size?: number; size_mb?: number; files?: number; error?: string } {
  if (!existsSync(projectPath)) return { ok: false, error: 'no such directory' }
  const base = projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'project'
  const parts = [base]
  const tag = version.trim().replace(/\//g, '-')
  if (tag) parts.push(`v${tag}`)
  if (label.trim()) parts.push(label.trim().replace(/\s+/g, '_').slice(0, 24))
  parts.push(stamp())

  const name = `${parts.join('-')}.zip`
  const target = join(backupsDir(projectPath), name)
  const count = writeZip(target, collect(projectPath))
  const size = statSync(target).size
  return {
    ok: true,
    file: name,
    path: target,
    size,
    size_mb: Math.round((size / 1024 / 1024) * 100) / 100,
    files: count
  }
}

export function listing(projectPath: string): BackupInfo[] {
  const dir = backupsDir(projectPath)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((f) => f.endsWith('.zip'))
    .sort()
    .reverse()
    .map((file) => {
      const st = statSync(join(dir, file))
      return {
        file,
        size: st.size,
        size_mb: Math.round((st.size / 1024 / 1024) * 100) / 100,
        created_at: new Date(st.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')
      }
    })
}

export function remove(projectPath: string, filename: string): { ok: boolean; error?: string } {
  // basename-only: never let a crafted name escape the backups directory.
  const safe = filename.split(/[/\\]/).pop() ?? ''
  const target = join(backupsDir(projectPath), safe)
  if (!existsSync(target)) return { ok: false, error: 'not found' }
  rmSync(target)
  return { ok: true }
}

/** Checksum of a snapshot, so a restore can be pointed at a known file. */
export function fingerprint(projectPath: string, filename: string): string | null {
  const safe = filename.split(/[/\\]/).pop() ?? ''
  const target = join(backupsDir(projectPath), safe)
  if (!existsSync(target)) return null
  return createHash('sha256').update(readFileSync(target)).digest('hex').slice(0, 16)
}
