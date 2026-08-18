#!/usr/bin/env python3
"""Turn an Orca checkout into PlanIDE.

Applies two things to a clone of stablyai/orca:

  1. Branding   — the app becomes PlanIDE (name, appId, protocol, artifacts).
  2. Integration — the PlanIDE tracker panel becomes a native right-sidebar tab,
                   and the main process starts the tracker engine on launch.

Why a script instead of vendoring a 210 MB fork: upstream Orca moves fast. This
keeps our own code (ide/overlay/**) as the only thing we maintain, and re-applies
it onto any upstream revision — bump PINNED_COMMIT to move.

Every edit is anchored to an exact upstream string and verified:
  * anchor missing        -> hard error naming the file (upstream drifted)
  * replacement present   -> skipped (idempotent, safe to re-run)

Usage:
    python3 ide/apply.py <path-to-orca-checkout>
    python3 ide/apply.py --check <path>     # report only, change nothing
"""

from __future__ import annotations

import os
import shutil
import sys

# Upstream revision this overlay was written against and verified on.
PINNED_COMMIT = "79be5b7fde1a78bf5aca52999167b55d2d72ffdf"  # 2026-08-18, v1.4.178-rc.2

HERE = os.path.dirname(os.path.abspath(__file__))
OVERLAY = os.path.join(HERE, "overlay")

PRODUCT = "PlanIDE"
APP_ID = "com.thepunisher.planide"
PROTOCOL = "planide"

# --------------------------------------------------------------------------- #
# edits: (relative path, anchor, replacement, description)
# The anchor must appear EXACTLY once in the upstream file.
# --------------------------------------------------------------------------- #
EDITS: list[tuple[str, str, str, str]] = [
    # ---- branding -------------------------------------------------------- #
    (
        "src/main/startup/dev-instance-identity.ts",
        "const BASE_APP_NAME = 'Orca'",
        f"const BASE_APP_NAME = '{PRODUCT}'",
        "app name (menu / About / window)",
    ),
    (
        "src/main/startup/dev-instance-identity.ts",
        "const BASE_APP_USER_MODEL_ID = 'com.stablyai.orca'",
        f"const BASE_APP_USER_MODEL_ID = '{APP_ID}'",
        "Windows AppUserModelID",
    ),
    (
        "config/electron-builder.config.cjs",
        "const appId = 'com.stablyai.orca'",
        f"const appId = '{APP_ID}'",
        "bundle id",
    ),
    (
        "config/electron-builder.config.cjs",
        "  productName: 'Orca',",
        f"  productName: '{PRODUCT}',",
        "installer product name",
    ),
    (
        "config/electron-builder.config.cjs",
        "  protocols: [{ name: 'Orca', schemes: ['orca'] }],",
        f"  protocols: [{{ name: '{PRODUCT}', schemes: ['{PROTOCOL}'] }}],",
        "deep-link scheme",
    ),
    (
        "config/electron-builder.config.cjs",
        "    executableName: 'Orca'",
        f"    executableName: '{PRODUCT}'",
        "executable name",
    ),
    (
        "config/electron-builder.config.cjs",
        "    executableName: 'orca-ide',",
        "    executableName: 'planide',",
        "linux executable name",
    ),
    # ---- ship the tracker engine inside packaged builds ------------------ #
    # Why extraResources and not app.asar: the engine is executed by a real
    # python interpreter, which cannot read files out of an asar archive.
    (
        "config/electron-builder.config.cjs",
        "const commonExtraResources = [relayExtraResource, bundledPluginResources, skillFreshnessResources]",
        "// PlanIDE: the tracker engine must stay a real directory on disk --\n"
        "// python executes it, and nothing can be run from inside app.asar.\n"
        "const planIdeTrackerResource = { from: 'tracker', to: 'tracker' }\n"
        "const commonExtraResources = [\n"
        "  relayExtraResource,\n"
        "  bundledPluginResources,\n"
        "  skillFreshnessResources,\n"
        "  planIdeTrackerResource\n"
        "]",
        "bundle tracker/ as an extraResource (all platforms)",
    ),
    (
        "config/electron-builder.config.cjs",
        "    '!src{,/**/*}',",
        "    '!src{,/**/*}',\n    // PlanIDE: shipped via extraResources above; keep it out of app.asar.\n    '!tracker{,/**/*}',",
        "keep tracker/ out of app.asar (shipped as a resource instead)",
    ),
    # ---- stop the engine we started on quit ------------------------------ #
    (
        "src/main/index.ts",
        "app.on('before-quit', () => {\n  if (isQuittingForUpdate()) {",
        "app.on('before-quit', () => {\n  // PlanIDE: stop the tracker engine this app started (an engine that was\n  // already running standalone is deliberately left alone).\n  stopPlanIdeEngine()\n  if (isQuittingForUpdate()) {",
        "stop the tracker engine on quit",
    ),
    # ---- integration: the sidebar tab ------------------------------------ #
    (
        "src/shared/ui-chrome-types.ts",
        "  | 'source-control'\n  | 'checks'\n  | 'ports'",
        "  | 'source-control'\n  | 'checks'\n  | 'ports'\n  // PlanIDE project tracker (board / fixes / roadmap).\n  | 'planide'",
        "register the 'planide' sidebar tab",
    ),
    (
        "src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts",
        "import { Plug, Files, GitBranch, ListChecks, Workflow } from 'lucide-react'",
        "import { Plug, Files, GitBranch, ListChecks, Workflow, Radar } from 'lucide-react'",
        "tracker tab icon import",
    ),
    (
        "src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts",
        """      {
        id: 'explorer',""",
        """      {
        id: 'planide',
        icon: Radar,
        title: translate('planide.sidebar.tab', 'Tracker'),
        shortcut: ''
      },
      {
        id: 'explorer',""",
        "tracker tab in the activity bar",
    ),
    (
        "src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx",
        "const PluginPanel = lazy(() => import('./PluginPanel'))",
        "const PluginPanel = lazy(() => import('./PluginPanel'))\nconst PlanIdePanel = lazy(() => import('./PlanIdePanel'))",
        "tracker panel import",
    ),
    (
        "src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx",
        "        {effectiveTab === 'explorer' && <FileExplorer />}",
        "        {effectiveTab === 'planide' && <PlanIdePanel />}\n        {effectiveTab === 'explorer' && <FileExplorer />}",
        "render the tracker panel",
    ),
    # ---- integration: start the tracker engine --------------------------- #
    (
        "src/main/index.ts",
        "void app.whenReady().then(async () => {\n  logStartupMilestone('app-ready')",
        "void app.whenReady().then(async () => {\n  logStartupMilestone('app-ready')\n  // PlanIDE: bring up the tracker engine that backs the sidebar panel.\n  // Non-blocking and failure-tolerant — the IDE must boot even without it.\n  void startPlanIdeEngine()",
        "start the tracker engine on launch",
    ),
    (
        "src/main/index.ts",
        "import { app, BrowserWindow",
        "import {\n  registerPlanIdeBridge,\n  startPlanIdeEngine,\n  stopPlanIdeEngine\n} from './planide/engine-service'\nimport { app, BrowserWindow",
        "tracker engine import",
    ),
    # ---- integration: the renderer<->engine IPC bridge -------------------- #
    # Why IPC and not fetch from the renderer: an Electron renderer is a
    # different origin from the engine's loopback port, so a JSON POST would
    # preflight and hit the engine's CSRF guard. Proxying main-side keeps that
    # guard strict instead of allowing `null` origins.
    (
        "src/main/index.ts",
        "  void startPlanIdeEngine()",
        "  registerPlanIdeBridge()\n  void startPlanIdeEngine()",
        "register the renderer bridge",
    ),
    (
        "src/preload/index.ts",
        "import { glApi } from './gitlab'",
        "import { glApi } from './gitlab'\nimport { planIdeApi } from './planide'",
        "tracker bridge import (preload)",
    ),
    (
        "src/preload/index.ts",
        "  gl: glApi,",
        "  gl: glApi,\n\n  // PlanIDE tracker bridge; see src/preload/planide.ts for why this is IPC\n  // rather than a direct renderer fetch.\n  planide: planIdeApi,",
        "expose window.api.planide",
    ),
]

# Files copied verbatim from ide/overlay/ into the checkout.
OVERLAY_FILES = [
    "src/main/planide/engine-service.ts",
    "src/preload/planide.ts",
    "src/renderer/src/components/right-sidebar/PlanIdePanel.tsx",
    "src/renderer/src/components/right-sidebar/planide-engine-client.ts",
]

# package.json scalar fields.
PKG_FIELDS = {
    "name": "planide",
    "description": "PlanIDE — parallel agentic IDE with a built-in project tracker",
}


class Fail(Exception):
    pass


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def write(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def apply_edits(root: str, check_only: bool) -> tuple[int, int, list[str]]:
    applied = skipped = 0
    problems: list[str] = []
    for rel, anchor, replacement, desc in EDITS:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            problems.append(f"missing file: {rel} ({desc})")
            continue
        text = read(path)
        if replacement in text:
            skipped += 1
            continue
        count = text.count(anchor)
        if count != 1:
            problems.append(
                f"anchor {'not found' if count == 0 else f'found {count}x'} in {rel} "
                f"-- upstream drifted for: {desc}"
            )
            continue
        if not check_only:
            write(path, text.replace(anchor, replacement, 1))
        applied += 1
    return applied, skipped, problems


def copy_overlay(root: str, check_only: bool) -> tuple[int, list[str]]:
    copied = 0
    problems: list[str] = []
    for rel in OVERLAY_FILES:
        src = os.path.join(OVERLAY, rel)
        if not os.path.isfile(src):
            problems.append(f"overlay file missing from this repo: {rel}")
            continue
        dst = os.path.join(root, rel)
        if not check_only:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        copied += 1
    return copied, problems


def patch_package_json(root: str, check_only: bool) -> list[str]:
    import json

    path = os.path.join(root, "package.json")
    if not os.path.isfile(path):
        return ["missing package.json"]
    text = read(path)
    data = json.loads(text)
    changed = False
    for key, value in PKG_FIELDS.items():
        if data.get(key) != value:
            data[key] = value
            changed = True
    # Note: packaging inputs (extraResources, asar excludes) are NOT here --
    # Orca configures electron-builder in config/electron-builder.config.cjs,
    # and package.json has no "build" key at all. The tracker is shipped by the
    # anchored edits to that .cjs file instead. Writing it here would have
    # silently done nothing.
    if changed and not check_only:
        write(path, json.dumps(data, indent=2) + "\n")
    return []


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    check_only = "--check" in argv
    if not args:
        print(__doc__)
        return 2
    root = os.path.abspath(os.path.expanduser(args[0]))
    if not os.path.isfile(os.path.join(root, "package.json")):
        print(f"error: {root} does not look like an Orca checkout")
        return 1

    print(f"{'checking' if check_only else 'applying'} PlanIDE overlay -> {root}")
    copied, copy_problems = copy_overlay(root, check_only)
    applied, skipped, edit_problems = apply_edits(root, check_only)
    pkg_problems = patch_package_json(root, check_only)
    problems = copy_problems + edit_problems + pkg_problems

    print(f"  overlay files : {copied}")
    print(f"  edits applied : {applied}")
    print(f"  already done  : {skipped}")
    if problems:
        print(f"  PROBLEMS      : {len(problems)}")
        for p in problems:
            print(f"    - {p}")
        print(
            "\nUpstream Orca changed under this overlay. Re-anchor the failing edits\n"
            f"in ide/apply.py, or check out the pinned revision:\n  {PINNED_COMMIT}"
        )
        return 1

    if not check_only:
        print(f"\n{PRODUCT} overlay applied. Next:")
        print(f"  cd {root} && pnpm install && pnpm dev")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
