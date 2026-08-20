#!/usr/bin/env python3
"""Turn an Orca checkout into PlanIDE.

Applies two things to a clone of stablyai/orca:

  1. Branding   — the app becomes PlanIDE (name, appId, protocol, artifacts, icons).
  2. Integration — the tracker becomes a top-level Tracker page and a
                   right-sidebar tab, both backed by main-process code. There is
                   no server, no port and no extra runtime: the tracker reads and
                   writes each project's own .planide/state.json directly.

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

PRODUCT = "PulsarIDE"
APP_ID = "com.thepunisher.pulsaride"
PROTOCOL = "pulsar"

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
        f"  protocols: [{{ name: '{PRODUCT}', schemes: ['{PROTOCOL}', 'planide', 'orca'] }}],",
        "deep-link scheme (keeps 'planide'/'orca' so existing links still open)",
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
        "    executableName: 'pulsaride',",
        "linux executable name",
    ),
    # Installer filenames: what you actually download from the releases page.
    (
        "config/electron-builder.config.cjs",
        "    artifactName: 'orca-windows-setup.${ext}',",
        "    artifactName: 'pulsar-windows-setup.${ext}',",
        "Windows installer filename",
    ),
    (
        "config/electron-builder.config.cjs",
        "    artifactName: isLinuxArm64Release ? 'orca-linux-arm64.${ext}' : 'orca-linux.${ext}'",
        "    artifactName: isLinuxArm64Release\n      ? 'pulsar-linux-arm64.${ext}'\n      : 'pulsar-linux.${ext}'",
        "Linux AppImage filename",
    ),
    (
        "config/electron-builder.config.cjs",
        "    artifactName: 'orca-macos-${arch}.${ext}'",
        "    artifactName: 'pulsar-macos-${arch}.${ext}'",
        "macOS artifact filename",
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
        "import { Plug, Files, GitBranch, ListChecks, Workflow } from 'lucide-react'\n"
        "import { PlanIdeMark } from '../planide/PlanIdeMark'",
        "tracker tab icon import",
    ),
    (
        "src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts",
        """      {
        id: 'explorer',""",
        """      {
        id: 'planide',
        icon: PlanIdeMark,
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
        "void app.whenReady().then(async () => {\n  logStartupMilestone('app-ready')\n"
        "  // PlanIDE: the tracker is main-process code -- registering its IPC is\n"
        "  // all there is to start. No server, no port, no child process.\n"
        "  registerPlanIdeIpc()",
        "register the tracker IPC on launch",
    ),
    (
        "src/main/index.ts",
        "import { app, BrowserWindow",
        "import { registerPlanIdeIpc } from './planide/ipc'\nimport { app, BrowserWindow",
        "tracker IPC import",
    ),
    # ---- integration: the renderer bridge --------------------------------- #
    (
        "src/preload/index.ts",
        "import { glApi } from './gitlab'",
        "import { glApi } from './gitlab'\nimport { planIdeApi } from './planide'",
        "tracker bridge import (preload)",
    ),
    # ---- integration: the full-page tracker view ------------------------- #
    # The sidebar panel is the glanceable version; this is the workbench, so the
    # tracker lives entirely inside the IDE instead of in a separate browser tab.
    (
        "src/shared/ui-chrome-types.ts",
        "export type TopLevelView =\n  | 'terminal'",
        "export type TopLevelView =\n  | 'terminal'\n  // PlanIDE tracker workbench (board / protected / activity / briefing).\n  | 'planide'",
        "register 'planide' as a top-level view",
    ),
    # Eight hand-written unions in the UI slice enumerate every top-level view
    # except their own -- they are not derived from TopLevelView, so a new view
    # has to be added to each by hand. Orca's own typecheck catches this; the
    # bundler does not, which is why it only showed up in a full build.
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeTasks:\n    | 'terminal'",
        "  previousViewBeforeTasks:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeTasks accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeSettings:\n    | 'terminal'",
        "  previousViewBeforeSettings:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeSettings accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeActivity:\n    | 'terminal'",
        "  previousViewBeforeActivity:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeActivity accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeAutomations:\n    | 'terminal'",
        "  previousViewBeforeAutomations:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeAutomations accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeSpace:\n    | 'terminal'",
        "  previousViewBeforeSpace:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeSpace accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeSkills:\n    | 'terminal'",
        "  previousViewBeforeSkills:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeSkills accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeMobile:\n    | 'terminal'",
        "  previousViewBeforeMobile:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeMobile accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeArtifacts:\n    | 'terminal'",
        "  previousViewBeforeArtifacts:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'terminal'",
        "previousViewBeforeArtifacts accepts the tracker",
    ),
    # And the zod enum the persisted UI state is validated against: a compile-time
    # parity assertion in ui-state-schema-parity-checks.ts fails if the schema
    # cannot accept a value the type allows.
    (
        "src/main/runtime/rpc/methods/client-ui-schemas.ts",
        "const STATIC_RIGHT_SIDEBAR_TABS = [\n  'explorer',",
        "const STATIC_RIGHT_SIDEBAR_TABS = [\n  // PlanIDE: the tracker tab is a real sidebar tab, so a client may persist it.\n  'planide',\n  'explorer',",
        "the tracker is a valid persisted sidebar tab",
    ),
    (
        "src/main/runtime/rpc/methods/client-ui-schemas.ts",
        "const TopLevelViewSchema = z.enum([\n  'terminal',",
        "const TopLevelViewSchema = z.enum([\n  // PlanIDE: the tracker is a top-level view.\n  'planide',\n  'terminal',",
        "the tracker is a valid persisted view",
    ),
    (
        "src/shared/top-level-view.ts",
        "const TOP_LEVEL_VIEW_LOOKUP: Record<TopLevelView, true> = {\n  terminal: true,",
        "const TOP_LEVEL_VIEW_LOOKUP: Record<TopLevelView, true> = {\n  terminal: true,\n  planide: true,",
        "allow 'planide' through the persistence guard",
    ),
    (
        "src/renderer/src/app-shell/AppWorkspaceShell.tsx",
        "      {activeView === 'settings' ? <Settings /> : null}",
        "      {activeView === 'planide' ? <PlanIdeView /> : null}\n      {activeView === 'settings' ? <Settings /> : null}",
        "render the tracker workbench",
    ),
    (
        "src/renderer/src/app-shell/AppWorkspaceShell.tsx",
        "function ActivePage({ layout }: { layout: AppChromeLayout }): React.JSX.Element {",
        "const PlanIdeView = lazy(() => import('../components/planide/PlanIdeView'))\n\nfunction ActivePage({ layout }: { layout: AppChromeLayout }): React.JSX.Element {",
        "lazy-import the tracker workbench",
    ),
    (
        "src/renderer/src/components/sidebar/SidebarNav.tsx",
        "  const skillsActive = activeView === 'skills'",
        "  const skillsActive = activeView === 'skills'\n  const planIdeActive = activeView === 'planide'\n  const setActiveView = useAppStore((s) => s.setActiveView)",
        "tracker nav state",
    ),
    (
        "src/renderer/src/components/sidebar/SidebarNav.tsx",
        "      <SetupGuideSidebarEntry />\n      <SidebarTaskNavButton />",
        """      <SetupGuideSidebarEntry />
      <SidebarTaskNavButton />
      {/* PlanIDE: the tracker workbench sits with the other top-level pages. */}
      <button
        type="button"
        onClick={() => setActiveView('planide')}
        aria-current={planIdeActive ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
          planIdeActive
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
        )}
      >
        <PlanIdeMark
          size={16}
          className={cn('size-4 shrink-0', !planIdeActive && 'text-worktree-sidebar-foreground/30')}
          strokeWidth={planIdeActive ? 2.25 : 1.75}
        />
        <span className="flex-1">{translate('planide.nav.tracker', 'Tracker')}</span>
      </button>""",
        "tracker entry in the left nav",
    ),
    (
        "src/renderer/src/components/sidebar/SidebarNav.tsx",
        "import { Bell, BookOpen, CalendarClock, EyeOff, Files, Search, Smartphone } from 'lucide-react'",
        "import { Bell, BookOpen, CalendarClock, EyeOff, Files, Search, Smartphone } from 'lucide-react'\n"
        "import { PlanIdeMark } from '../planide/PlanIdeMark'",
        "tracker nav icon",
    ),
    (
        "src/preload/index.ts",
        "  gl: glApi,",
        "  gl: glApi,\n\n  // PlanIDE tracker bridge; see src/preload/planide.ts for why this is IPC\n  // rather than a direct renderer fetch.\n  planide: planIdeApi,",
        "expose window.api.planide",
    ),
    # ---- integration: agents write their own trail --------------------------- #
    # Orca already knows when an agent finishes a turn; the tracker listens to the
    # same signal so the Activity trail is complete even for agents that never
    # call the CLI or MCP. Anchored on the import the previous edit inserts --
    # edits run in list order, so it is present by the time this one runs, and it
    # keeps the two imports from fighting over one upstream line (which broke
    # idempotency once already).
    (
        "src/main/index.ts",
        "import { registerPlanIdeIpc } from './planide/ipc'",
        "import { recordAgentTurn } from './planide/agent-events'\n"
        "import { registerPlanIdeIpc } from './planide/ipc'",
        "agent-turn recorder import",
    ),
    (
        "src/main/index.ts",
        "      if (!restoredUnconfirmed) {\n"
        "        maybeAutoRenameBranchOnFirstWorkFromHook({ paneKey, tabId, worktreeId, payload, isReplay })\n"
        "      }",
        "      if (!restoredUnconfirmed) {\n"
        "        maybeAutoRenameBranchOnFirstWorkFromHook({ paneKey, tabId, worktreeId, payload, isReplay })\n"
        "        // PlanIDE: log the finished turn in that project's tracker. Everything\n"
        "        // it needs to ignore (replays, session boundaries, duplicates, untracked\n"
        "        // projects) is decided inside, and it can never throw into this pipeline.\n"
        "        recordAgentTurn({ worktreeId, paneKey, isReplay, promptInteractionKey, payload })\n"
        "      }",
        "record finished agent turns in the tracker",
    ),
]

# Files copied verbatim from ide/overlay/ into the checkout.
OVERLAY_FILES = [
    "src/main/planide/store.ts",
    "src/main/planide/detect.ts",
    "src/main/planide/report.ts",
    "src/main/planide/git.ts",
    "src/main/planide/backup.ts",
    "src/main/planide/ipc.ts",
    "src/main/planide/agent-events.ts",
    "src/main/planide/auto-push.ts",
    "src/preload/planide.ts",
    "src/renderer/src/components/right-sidebar/PlanIdePanel.tsx",
    "src/renderer/src/components/right-sidebar/planide-engine-client.ts",
    "src/renderer/src/components/planide/PlanIdeView.tsx",
    "src/renderer/src/components/planide/PlanIdeMark.tsx",
    "src/renderer/src/components/planide/PlanIdeSync.tsx",
    "src/renderer/src/components/planide/PlanIdeBackups.tsx",
    # Branding: these replace Orca's own icons, so the packaged app, its
    # installer, the dock and the taskbar all wear the PlanIDE mark. Generated
    # from assets/icon.svg by ide/design/make-icons.mjs -- edit the SVG, re-run
    # that, never hand-edit the binaries.
    "resources/icon.png",
    "resources/icon-dev.png",
    "resources/build/icon.png",
    "resources/build/icon.ico",
    "resources/build/icon.icns",
]

# package.json scalar fields.
PKG_FIELDS = {
    "name": "pulsaride",
    "description": "PulsarIDE — parallel agentic IDE with a built-in project tracker and ThePunisher agents",
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


# Locale files whose app-identity strings get rebranded to PulsarIDE.
LOCALES = ["en", "es", "ja", "ko", "zh"]

# Keys whose path (lowercased) contains any of these name a real, external
# Stably service or artifact -- Orca Cloud, Relay, the account/sign-in, the
# mobile companion app, the `orca` CLI binary, the GitHub star link, orca.yaml,
# plugin provenance. Renaming those would point a user at something that does
# not exist under the PulsarIDE name, so they are left exactly as upstream ships
# them. Everything else -- what the app calls *itself* -- is rebranded.
LOCALE_SKIP_KEY_HINTS = (
    "cloud", "relay", "account", "mobile", "cli", "browseruse",
    "repositoryhooks", # orca.yaml
    "pluginconsent",   # "Bundled with Orca"
    "runtimehostaccess",
)
# Values naming an external Stably service/artifact are skipped even when the key
# looks generic -- a value like "Orca Cloud" under an unrelated key must not
# become "PulsarIDE Cloud". These are the real external names, verbatim.
LOCALE_SKIP_VALUE_HINTS = (
    "orca.yaml", "App Store", "TestFlight", "onorca.dev",
    "Orca Cloud", "Orca Relay", "Orca account", "Orca Account",
    "Sign in to Orca", "Sign out of Orca",
    "Star Orca", "Orca on GitHub", "Star us on",
    "Orca CLI", "Enable Orca CLI", "Orca Mobile", "Open Orca Mobile",
    "Name in Orca", "Bundled with Orca",
)


def _rebrand_value(value: str) -> str:
    import re
    # Case-sensitive and whole-word: the app calls itself "Orca"/"ORCA", while
    # the CLI's own commands are lowercase ("orca status"), so this leaves real
    # commands and filenames (orca.yaml, orca-ide) untouched by construction.
    out = re.sub(r"\bOrca\b", PRODUCT, value)
    out = re.sub(r"\bORCA\b", PRODUCT.upper(), out)
    return out


def patch_locale(root: str, check_only: bool) -> tuple[int, list[str]]:
    """Rebrand app-identity strings Orca -> PulsarIDE across the locale catalogs.

    Returns (changed_count, skipped_keys) so the caller/tests can see exactly
    what was and was not touched.
    """
    import json

    changed = 0
    skipped: list[str] = []

    def walk(node, path, on):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else k, on)
        elif isinstance(node, str):
            on(path, node)

    for loc in LOCALES:
        path = os.path.join(root, "src/renderer/src/i18n/locales", f"{loc}.json")
        if not os.path.isfile(path):
            continue
        data = json.loads(read(path))
        pending: list[tuple[list[str], str]] = []

        def visit(dotted, value):
            low = dotted.lower()
            if any(h in low for h in LOCALE_SKIP_KEY_HINTS):
                if "Orca" in value or "ORCA" in value:
                    skipped.append(f"{loc}:{dotted}")
                return
            if any(h in value for h in LOCALE_SKIP_VALUE_HINTS):
                skipped.append(f"{loc}:{dotted}")
                return
            new = _rebrand_value(value)
            if new != value:
                pending.append((dotted.split("."), new))

        walk(data, "", visit)
        for keys, new in pending:
            cur = data
            for k in keys[:-1]:
                cur = cur[k]
            cur[keys[-1]] = new
            changed += 1
        if pending and not check_only:
            write(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    # de-dup skipped across locales for a tidy report
    return changed, sorted(set(skipped))


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
    locale_changed, locale_skipped = patch_locale(root, check_only)
    problems = copy_problems + edit_problems + pkg_problems

    print(f"  overlay files : {copied}")
    print(f"  edits applied : {applied}")
    print(f"  already done  : {skipped}")
    print(f"  locale strings: {locale_changed} rebranded, {len(locale_skipped)} left (Orca services)")
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
