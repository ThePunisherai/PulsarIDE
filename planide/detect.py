"""Auto-detect a project's language/stack and its high-level type.

Two signals are combined:
  1. Marker files (package.json, Cargo.toml, *.csproj, ...) -- high confidence.
  2. Source-extension census -- a fallback / tie-breaker for folders with no
     recognised manifest (a pile of .cpp, a bag of .py scripts, ...).

The result also guesses a project *type* the tracker cares about:
  web | desktop-exe | emulator | mobile | game | library | cli | data | custom

Nothing here writes to disk; it only reads. Big/无关 directories
(node_modules, .git, venv, target, build, dist) are skipped while walking so a
detect pass on a large repo stays fast.
"""

from __future__ import annotations

import os
from collections import Counter

# Directories never worth walking into for detection or backup scans.
SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "env",
    "__pycache__", ".mypy_cache", ".pytest_cache", "target", "build",
    "dist", "out", "bin", "obj", ".next", ".nuxt", ".gradle", ".idea",
    ".vs", ".vscode", "vendor", "Pods", "DerivedData", ".planide",
    "coverage", ".cache", "cmake-build-debug",
}

# marker file -> (language label, framework/stack hints, type hint)
MARKERS = [
    ("package.json", "JavaScript/TypeScript", "node", "web"),
    ("pnpm-lock.yaml", "JavaScript/TypeScript", "pnpm", "web"),
    ("deno.json", "TypeScript", "deno", "web"),
    ("tsconfig.json", "TypeScript", "typescript", "web"),
    ("requirements.txt", "Python", "pip", "cli"),
    ("pyproject.toml", "Python", "python", "library"),
    ("setup.py", "Python", "python", "library"),
    ("Pipfile", "Python", "pipenv", "cli"),
    ("environment.yml", "Python", "conda", "data"),
    ("Cargo.toml", "Rust", "cargo", "cli"),
    ("go.mod", "Go", "go", "cli"),
    ("pom.xml", "Java", "maven", "library"),
    ("build.gradle", "Java/Kotlin", "gradle", "library"),
    ("build.gradle.kts", "Kotlin", "gradle", "library"),
    ("composer.json", "PHP", "composer", "web"),
    ("Gemfile", "Ruby", "bundler", "web"),
    ("mix.exs", "Elixir", "mix", "web"),
    ("pubspec.yaml", "Dart/Flutter", "flutter", "mobile"),
    ("CMakeLists.txt", "C/C++", "cmake", "desktop-exe"),
    ("Makefile", "C/C++/Make", "make", "cli"),
    ("meson.build", "C/C++", "meson", "desktop-exe"),
    ("Package.swift", "Swift", "spm", "mobile"),
    ("build.zig", "Zig", "zig", "cli"),
    ("Dockerfile", "Docker", "docker", "web"),
    ("index.html", "HTML/CSS/JS", "static-web", "web"),
]

# extension -> language label (used for the census fallback)
EXT_LANG = {
    ".py": "Python", ".js": "JavaScript", ".mjs": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript", ".jsx": "JavaScript",
    ".rs": "Rust", ".go": "Go", ".java": "Java", ".kt": "Kotlin",
    ".c": "C", ".h": "C", ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
    ".hpp": "C++", ".cs": "C#", ".php": "PHP", ".rb": "Ruby",
    ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C++",
    ".dart": "Dart", ".ex": "Elixir", ".exs": "Elixir", ".zig": "Zig",
    ".lua": "Lua", ".sh": "Shell", ".ps1": "PowerShell", ".asm": "Assembly",
    ".html": "HTML", ".css": "CSS", ".vue": "Vue", ".svelte": "Svelte",
    ".sql": "SQL", ".r": "R", ".jl": "Julia", ".hs": "Haskell",
    ".scala": "Scala", ".clj": "Clojure", ".nim": "Nim", ".ml": "OCaml",
}

# framework hints found inside package.json dependencies -> (label, type)
JS_FRAMEWORKS = [
    ("electron", "Electron (desktop)", "desktop-exe"),
    ("next", "Next.js", "web"),
    ("nuxt", "Nuxt", "web"),
    ("react-native", "React Native", "mobile"),
    ("expo", "Expo (mobile)", "mobile"),
    ("react", "React", "web"),
    ("vue", "Vue", "web"),
    ("svelte", "Svelte", "web"),
    ("@angular/core", "Angular", "web"),
    ("vite", "Vite", "web"),
    ("express", "Express (server)", "web"),
    ("fastify", "Fastify (server)", "web"),
    ("tauri", "Tauri (desktop)", "desktop-exe"),
]

# emulator / low-level hints: substrings in file names or dep names.
EMULATOR_HINTS = ("emulator", "emulate", "cpu.", "opcode", "z80", "6502",
                  "gameboy", "gba", "nes", "chip8", "chip-8", "mos6502",
                  "instruction_set", "bytecode", "interpreter", "vm.")
GAME_HINTS = ("sdl", "sfml", "raylib", "godot", "unity", "unreal", "phaser",
              "pygame", "love2d", "bevy")


def _read_head(path: str, limit: int = 20000) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read(limit)
    except OSError:
        return ""


def _census(project_path: str, max_files: int = 4000):
    """Walk the tree (skipping heavy dirs) and count source extensions."""
    langs = Counter()
    names = []
    seen = 0
    has_exe = False
    for root, dirs, files in os.walk(project_path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            seen += 1
            if seen > max_files:
                break
            low = f.lower()
            names.append(low)
            if low.endswith(".exe"):
                has_exe = True
            ext = os.path.splitext(f)[1].lower()
            lang = EXT_LANG.get(ext)
            if lang:
                langs[lang] += 1
        if seen > max_files:
            break
    return langs, names, has_exe


def detect(project_path: str) -> dict:
    """Return {languages, stack, type, confidence, signals, markers}."""
    project_path = os.path.abspath(os.path.expanduser(project_path))
    signals = []
    markers_found = []
    stack = []
    type_votes = Counter()
    languages = []

    if not os.path.isdir(project_path):
        return {
            "languages": [], "stack": [], "type": "unknown",
            "confidence": "none", "signals": ["path does not exist"],
            "markers": [],
        }

    top = set()
    try:
        top = set(os.listdir(project_path))
    except OSError:
        pass

    # 1) marker files at the project root
    for fname, lang, hint, type_hint in MARKERS:
        if fname in top:
            markers_found.append(fname)
            if lang not in languages:
                languages.append(lang)
            if hint not in stack:
                stack.append(hint)
            type_votes[type_hint] += 2
            signals.append("found %s" % fname)

    # 1b) inspect package.json for real frameworks + electron/react-native
    if "package.json" in top:
        pj = _read_head(os.path.join(project_path, "package.json"))
        low = pj.lower()
        for dep, label, type_hint in JS_FRAMEWORKS:
            if ('"%s"' % dep) in low or ("/%s" % dep) in low:
                if label not in stack:
                    stack.append(label)
                type_votes[type_hint] += 3
                signals.append("dependency: %s" % dep)

    # 1c) .NET / C# projects (exe territory)
    if any(n.endswith(".csproj") or n.endswith(".sln") for n in top):
        if "C#/.NET" not in languages:
            languages.append("C#/.NET")
        stack.append("dotnet")
        type_votes["desktop-exe"] += 2
        signals.append("found .csproj/.sln")

    # 2) extension census (fallback + tie-breaker)
    langs, names, has_exe = _census(project_path)
    for lang, _ in langs.most_common(6):
        if lang not in languages:
            languages.append(lang)
    if not markers_found and langs:
        signals.append("census: %s" % ", ".join(
            "%s x%d" % (l, c) for l, c in langs.most_common(4)))

    # 3) type heuristics from file/dep names
    joined = " ".join(names)
    if any(h in joined for h in EMULATOR_HINTS):
        type_votes["emulator"] += 4
        signals.append("emulator hints in filenames")
    if any(h in joined for h in GAME_HINTS):
        type_votes["game"] += 3
        signals.append("game engine hints")
    if has_exe:
        type_votes["desktop-exe"] += 2
        signals.append("contains .exe")
    if "index.html" in top and not markers_found:
        type_votes["web"] += 2

    # C/C++ heavy + no web markers => likely desktop/emulator/cli
    if languages and languages[0] in ("C", "C++", "C/C++"):
        type_votes["desktop-exe"] += 1

    # decide type
    if type_votes:
        ptype = type_votes.most_common(1)[0][0]
    elif languages:
        ptype = "library"
    else:
        ptype = "custom"

    # confidence
    if markers_found:
        confidence = "high"
    elif langs:
        confidence = "medium"
    else:
        confidence = "low"

    # de-dup stack
    stack = list(dict.fromkeys(stack))
    return {
        "languages": languages[:6],
        "stack": stack[:8],
        "type": ptype,
        "confidence": confidence,
        "signals": signals[:12],
        "markers": markers_found,
    }
