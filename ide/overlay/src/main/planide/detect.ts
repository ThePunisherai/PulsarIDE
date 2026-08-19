/**
 * Auto-detect a project's language/stack and its high-level type.
 *
 * Two signals combined: marker files (package.json, Cargo.toml, *.csproj, …),
 * which are high confidence, and a source-extension census as a fallback for
 * folders with no recognised manifest (a pile of .cpp, a bag of .py scripts).
 *
 * Read-only, and it skips the heavy directories so a scan of a large repo stays
 * fast.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Detected } from './store'

/** Never worth walking into, for detection or backups. */
export const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', 'env', '__pycache__',
  '.mypy_cache', '.pytest_cache', 'target', 'build', 'dist', 'out', 'bin', 'obj',
  '.next', '.nuxt', '.gradle', '.idea', '.vs', '.vscode', 'vendor', 'Pods',
  'DerivedData', '.planide', 'coverage', '.cache', 'cmake-build-debug'
])

type Marker = [file: string, language: string, stack: string, type: string]

const MARKERS: Marker[] = [
  ['package.json', 'JavaScript/TypeScript', 'node', 'web'],
  ['pnpm-lock.yaml', 'JavaScript/TypeScript', 'pnpm', 'web'],
  ['deno.json', 'TypeScript', 'deno', 'web'],
  ['tsconfig.json', 'TypeScript', 'typescript', 'web'],
  ['requirements.txt', 'Python', 'pip', 'cli'],
  ['pyproject.toml', 'Python', 'python', 'library'],
  ['setup.py', 'Python', 'python', 'library'],
  ['Pipfile', 'Python', 'pipenv', 'cli'],
  ['environment.yml', 'Python', 'conda', 'data'],
  ['Cargo.toml', 'Rust', 'cargo', 'cli'],
  ['go.mod', 'Go', 'go', 'cli'],
  ['pom.xml', 'Java', 'maven', 'library'],
  ['build.gradle', 'Java/Kotlin', 'gradle', 'library'],
  ['build.gradle.kts', 'Kotlin', 'gradle', 'library'],
  ['composer.json', 'PHP', 'composer', 'web'],
  ['Gemfile', 'Ruby', 'bundler', 'web'],
  ['mix.exs', 'Elixir', 'mix', 'web'],
  ['pubspec.yaml', 'Dart/Flutter', 'flutter', 'mobile'],
  ['CMakeLists.txt', 'C/C++', 'cmake', 'desktop-exe'],
  ['Makefile', 'C/C++/Make', 'make', 'cli'],
  ['meson.build', 'C/C++', 'meson', 'desktop-exe'],
  ['Package.swift', 'Swift', 'spm', 'mobile'],
  ['build.zig', 'Zig', 'zig', 'cli'],
  ['Dockerfile', 'Docker', 'docker', 'web'],
  ['index.html', 'HTML/CSS/JS', 'static-web', 'web']
]

const EXT_LANG: Record<string, string> = {
  '.py': 'Python', '.js': 'JavaScript', '.mjs': 'JavaScript', '.ts': 'TypeScript',
  '.tsx': 'TypeScript', '.jsx': 'JavaScript', '.rs': 'Rust', '.go': 'Go',
  '.java': 'Java', '.kt': 'Kotlin', '.c': 'C', '.h': 'C', '.cpp': 'C++',
  '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP',
  '.rb': 'Ruby', '.swift': 'Swift', '.m': 'Objective-C', '.mm': 'Objective-C++',
  '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.zig': 'Zig',
  '.lua': 'Lua', '.sh': 'Shell', '.ps1': 'PowerShell', '.asm': 'Assembly',
  '.html': 'HTML', '.css': 'CSS', '.vue': 'Vue', '.svelte': 'Svelte',
  '.sql': 'SQL', '.r': 'R', '.jl': 'Julia', '.hs': 'Haskell',
  '.scala': 'Scala', '.clj': 'Clojure', '.nim': 'Nim', '.ml': 'OCaml'
}

const JS_FRAMEWORKS: [dep: string, label: string, type: string][] = [
  ['electron', 'Electron (desktop)', 'desktop-exe'],
  ['next', 'Next.js', 'web'],
  ['nuxt', 'Nuxt', 'web'],
  ['react-native', 'React Native', 'mobile'],
  ['expo', 'Expo (mobile)', 'mobile'],
  ['react', 'React', 'web'],
  ['vue', 'Vue', 'web'],
  ['svelte', 'Svelte', 'web'],
  ['@angular/core', 'Angular', 'web'],
  ['vite', 'Vite', 'web'],
  ['express', 'Express (server)', 'web'],
  ['fastify', 'Fastify (server)', 'web'],
  ['tauri', 'Tauri (desktop)', 'desktop-exe']
]

const EMULATOR_HINTS = [
  'emulator', 'emulate', 'cpu.', 'opcode', 'z80', '6502', 'gameboy', 'gba',
  'nes', 'chip8', 'chip-8', 'mos6502', 'instruction_set', 'bytecode',
  'interpreter', 'vm.'
]
const GAME_HINTS = ['sdl', 'sfml', 'raylib', 'godot', 'unity', 'unreal', 'phaser', 'pygame', 'love2d', 'bevy']

function census(root: string, maxFiles = 4000): { langs: Map<string, number>; names: string[]; hasExe: boolean } {
  const langs = new Map<string, number>()
  const names: string[] = []
  let seen = 0
  let hasExe = false

  const walk = (dir: string): void => {
    if (seen > maxFiles) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (seen > maxFiles) return
      const full = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
        walk(full)
        continue
      }
      seen++
      const low = name.toLowerCase()
      names.push(low)
      if (low.endsWith('.exe')) hasExe = true
      const lang = EXT_LANG[extname(name).toLowerCase()]
      if (lang) langs.set(lang, (langs.get(lang) ?? 0) + 1)
    }
  }
  walk(root)
  return { langs, names, hasExe }
}

export function detect(projectPath: string): Detected {
  const signals: string[] = []
  const markers: string[] = []
  const stack: string[] = []
  const languages: string[] = []
  const typeVotes = new Map<string, number>()
  const vote = (t: string, n: number): void => {
    typeVotes.set(t, (typeVotes.get(t) ?? 0) + n)
  }

  if (!existsSync(projectPath)) {
    return {
      languages: [], stack: [], type: 'unknown', confidence: 'none',
      signals: ['path does not exist'], markers: []
    }
  }

  let top: string[] = []
  try {
    top = readdirSync(projectPath)
  } catch {
    /* unreadable directory: fall through to an empty census */
  }
  const topSet = new Set(top)

  for (const [file, lang, hint, typeHint] of MARKERS) {
    if (!topSet.has(file)) continue
    markers.push(file)
    if (!languages.includes(lang)) languages.push(lang)
    if (!stack.includes(hint)) stack.push(hint)
    vote(typeHint, 2)
    signals.push(`found ${file}`)
  }

  if (topSet.has('package.json')) {
    let pkg = ''
    try {
      pkg = readFileSync(join(projectPath, 'package.json'), 'utf8').slice(0, 20000).toLowerCase()
    } catch {
      /* unreadable manifest is simply no signal */
    }
    for (const [dep, label, typeHint] of JS_FRAMEWORKS) {
      if (pkg.includes(`"${dep}"`) || pkg.includes(`/${dep}`)) {
        if (!stack.includes(label)) stack.push(label)
        vote(typeHint, 3)
        signals.push(`dependency: ${dep}`)
      }
    }
  }

  if (top.some((n) => n.endsWith('.csproj') || n.endsWith('.sln'))) {
    if (!languages.includes('C#/.NET')) languages.push('C#/.NET')
    stack.push('dotnet')
    vote('desktop-exe', 2)
    signals.push('found .csproj/.sln')
  }

  const { langs, names, hasExe } = census(projectPath)
  const ranked = [...langs.entries()].sort((a, b) => b[1] - a[1])
  for (const [lang] of ranked.slice(0, 6)) if (!languages.includes(lang)) languages.push(lang)
  if (markers.length === 0 && ranked.length) {
    signals.push(`census: ${ranked.slice(0, 4).map(([l, c]) => `${l} x${c}`).join(', ')}`)
  }

  const joined = names.join(' ')
  if (EMULATOR_HINTS.some((h) => joined.includes(h))) {
    vote('emulator', 4)
    signals.push('emulator hints in filenames')
  }
  if (GAME_HINTS.some((h) => joined.includes(h))) {
    vote('game', 3)
    signals.push('game engine hints')
  }
  if (hasExe) {
    vote('desktop-exe', 2)
    signals.push('contains .exe')
  }
  if (topSet.has('index.html') && markers.length === 0) vote('web', 2)
  if (['C', 'C++', 'C/C++'].includes(languages[0])) vote('desktop-exe', 1)

  let type = 'custom'
  if (typeVotes.size) {
    type = [...typeVotes.entries()].sort((a, b) => b[1] - a[1])[0][0]
  } else if (languages.length) {
    type = 'library'
  }

  const confidence = markers.length ? 'high' : ranked.length ? 'medium' : 'low'

  return {
    languages: languages.slice(0, 6),
    stack: [...new Set(stack)].slice(0, 8),
    type,
    confidence,
    signals: signals.slice(0, 12),
    markers
  }
}
