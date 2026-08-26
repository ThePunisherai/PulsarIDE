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
PINNED_COMMIT = "8d61cb8b771b7b658a5e1e2bb426c719644d09f3"  # 2026-08-26, upstream HEAD

HERE = os.path.dirname(os.path.abspath(__file__))
OVERLAY = os.path.join(HERE, "overlay")

PRODUCT = "PulsarIDE"
APP_ID = "com.thepunisher.pulsaride"
PROTOCOL = "pulsar"
# Where the app looks for its own updates, and where releases are published.
RELEASE_OWNER = "ThePunisherai"
RELEASE_NAME = "PulsarIDE"
RELEASE_REPO = f"{RELEASE_OWNER}/{RELEASE_NAME}"

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
    # ---- branding: the PulsarIDE theme ----------------------------------- #
    # Imported straight after Orca's own stylesheet in BOTH renderer entry
    # points (the main window and the pop-out), so a popped-out panel is not
    # left wearing Orca's palette.
    (
        "src/renderer/src/main.tsx",
        "import './assets/main.css'",
        "import './assets/main.css'\nimport './assets/pulsar-theme.css'",
        "PulsarIDE theme (main window)",
    ),
    (
        "src/renderer/src/popout.tsx",
        "import './assets/main.css'",
        "import './assets/main.css'\nimport './assets/pulsar-theme.css'",
        "PulsarIDE theme (pop-out window)",
    ),
    # ---- identity: our own home directory, not Orca's --------------------- #
    # Orca deliberately shares ~/.orca across instances -- its own comment says
    # "prod/dev/parallel Orca instances must write the same managed entry, not
    # race between per-userData script paths". That assumes every instance IS
    # Orca. PulsarIDE is a different app, so running both means both write the
    # SAME agent-hook launcher scripts, and whichever started last silently
    # owns every agent's hooks -- which is the "it mixes with Orca" report, and
    # a plausible reason subagents launched from one of them go unobserved.
    # userData is already separate (BASE_APP_NAME drives app.setName), so this
    # closes the remaining shared state.
    #
    # Only the state that must not be shared: the hook launchers every agent
    # config keeps invoking, the install lock two apps would contend on, the
    # Claude agent-teams shim (subagents), and relay session state. Credential
    # stores are deliberately left on ~/.orca -- sharing a Jira or Linear login
    # between the two is a feature, not a collision.
    (
        "src/main/agent-hooks/installer-utils.ts",
        "  return join(homedir(), '.orca', 'agent-hooks', scriptFileName)",
        "  return join(homedir(), '.pulsar', 'agent-hooks', scriptFileName)",
        "agent-hook launchers live under ~/.pulsar, not ~/.orca",
    ),
    (
        "src/main/agent-hooks/managed-hook-install-lock.ts",
        "  const lockParent = join(home, '.orca')",
        "  const lockParent = join(home, '.pulsar')",
        "hook install lock is ours, not contended with a real Orca",
    ),
    (
        "src/main/runtime/claude-agent-teams-shim-env.ts",
        "  return join(homedir(), '.orca', 'claude-agent-teams-bin')",
        "  return join(homedir(), '.pulsar', 'claude-agent-teams-bin')",
        "Claude agent-teams shim (subagents) is ours",
    ),
    (
        "src/relay/workspace-session-handler.ts",
        "    private baseDir = join(homedir(), '.orca', 'sessions')",
        "    private baseDir = join(homedir(), '.pulsar', 'sessions')",
        "relay session state is ours",
    ),
    (
        "src/main/grok/grok-hook-owners.ts",
        "  return join(homedir(), '.orca', 'agent-hooks', 'grok-owners')",
        "  return join(homedir(), '.pulsar', 'agent-hooks', 'grok-owners')",
        "Grok hook ownership is ours (same agent-hooks dir as the launchers)",
    ),
    (
        "src/main/orcad/orcad-app-paths.ts",
        # Anchored on the PRISTINE text: patch_source_strings rewrites the
        # 'Orca' literal to 'PulsarIDE' later, so anchoring on the patched form
        # matches nothing on a clean checkout.
        "  return xdg ? join(xdg, 'Orca') : join(homedir(), '.orca')",
        "  return xdg ? join(xdg, 'Orca') : join(homedir(), '.pulsar')",
        "daemon state dir: the XDG branch was already ours, the fallback was not",
    ),
    # ---- integration: the sidebar tab ------------------------------------ #
    (
        "src/shared/ui-chrome-types.ts",
        "  | 'source-control'\n  | 'checks'\n  | 'ports'",
        "  | 'source-control'\n  | 'checks'\n  | 'ports'\n"
        "  // PlanIDE project tracker (board / fixes / roadmap).\n  | 'planide'\n"
        "  // Pulse memory: the knowledge graph and the Obsidian notes. Sidebar\n"
        "  // tabs, not Tracker tabs -- you want them open WHILE you work.\n"
        "  | 'pulse-brain'\n  | 'pulse-obsidian'\n  | 'pulse-design'",
        "register the 'planide' sidebar tab",
    ),
    (
        "src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts",
        "import { Plug, Files, GitBranch, ListChecks, Workflow } from 'lucide-react'",
        "import { Plug, Files, GitBranch, ListChecks, Workflow } from 'lucide-react'\n"
        "import { BookText, Network, PenTool } from 'lucide-react'\n"
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
        id: 'pulse-brain',
        icon: Network,
        title: translate('planide.memory.brainTab', 'Brain Graph'),
        shortcut: ''
      },
      {
        id: 'pulse-obsidian',
        icon: BookText,
        title: translate('planide.memory.obsidianTab', 'Obsidian'),
        shortcut: ''
      },
      {
        id: 'pulse-design',
        icon: PenTool,
        title: translate('planide.design.tab', 'Open Design'),
        shortcut: ''
      },
      {
        id: 'explorer',""",
        "tracker tab in the activity bar",
    ),
    (
        "src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx",
        "const PluginPanel = lazy(() => import('./PluginPanel'))",
        "const PluginPanel = lazy(() => import('./PluginPanel'))\n"
        "const PlanIdePanel = lazy(() => import('./PlanIdePanel'))\n"
        "const BrainGraphSidebar = lazy(() =>\n"
        "  import('../planide/PulseMemory').then((m) => ({ default: m.BrainGraphSidebar }))\n"
        ")\n"
        "const ObsidianSidebar = lazy(() =>\n"
        "  import('../planide/PulseMemory').then((m) => ({ default: m.ObsidianSidebar }))\n"
        ")\n"
        "const OpenDesignSidebar = lazy(() =>\n"
        "  import('../planide/PulseDesign').then((m) => ({ default: m.OpenDesignSidebar }))\n"
        ")",
        "tracker panel import",
    ),
    (
        "src/renderer/src/components/right-sidebar/right-sidebar-panel-content.tsx",
        "        {effectiveTab === 'explorer' && <FileExplorer />}",
        "        {effectiveTab === 'planide' && <PlanIdePanel />}\n"
        "        {effectiveTab === 'pulse-brain' && <BrainGraphSidebar />}\n"
        "        {effectiveTab === 'pulse-obsidian' && <ObsidianSidebar />}\n"
        "        {effectiveTab === 'pulse-design' && <OpenDesignSidebar />}\n"
        "        {effectiveTab === 'explorer' && <FileExplorer />}",
        "render the tracker panel",
    ),
    (
        # The route normalizer has a runtime allowlist; a tab not in it snaps back
        # to 'explorer' on click. Without this, clicking the Tracker tab did nothing
        # (it was typed + rendered + persistence-guarded, but never allowed here).
        "src/renderer/src/store/right-sidebar-route.ts",
        "    tab === 'explorer' ||\n    tab === 'vault' ||",
        "    tab === 'planide' ||\n    tab === 'pulse-brain' ||\n    tab === 'pulse-obsidian' ||\n"
        "    tab === 'pulse-design' ||\n"
        "    tab === 'explorer' ||\n    tab === 'vault' ||",
        "let the tracker tab pass the route normalizer (else clicking it does nothing)",
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
    # All four main-process imports go in as ONE block, on purpose. They used to
    # be separate edits chained onto each other's output; that daisy-chain broke
    # idempotency, because a later edit split an earlier one's replacement so its
    # "already applied?" check could no longer find it. One block cannot desync
    # with itself. Anchored on the node:fs import: upstream keeps it single-line
    # (the electron import next to it has already been reflowed once).
    (
        "src/main/index.ts",
        "import { existsSync, statSync } from 'node:fs'",
        "import { existsSync, statSync } from 'node:fs'\n"
        "import { deployAgentBundle } from './planide/agent-bundle'\n"
        "import { recordAgentTurn } from './planide/agent-events'\n"
        "import { maybeSyncMemory } from './planide/memory-sync'\n"
        "import { registerPlanIdeIpc } from './planide/ipc'",
        "tracker + agent-bundle main-process imports",
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
        "export type TopLevelView =\n  | 'terminal'\n  // PlanIDE tracker workbench (board / protected / activity / briefing).\n  | 'planide'\n  // The same two surfaces as the sidebar tabs of these names, opened full\n  // page from the left nav. Separate type from RightSidebarTab, so the\n  // shared ids are deliberate rather than a collision.\n  | 'pulse-brain'\n  | 'pulse-design'",
        "register 'planide' as a top-level view",
    ),
    # Eight hand-written unions in the UI slice enumerate every top-level view
    # except their own -- they are not derived from TopLevelView, so a new view
    # has to be added to each by hand. Orca's own typecheck catches this; the
    # bundler does not, which is why it only showed up in a full build.
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeTasks:\n    | 'terminal'",
        "  previousViewBeforeTasks:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeTasks accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeSettings:\n    | 'terminal'",
        "  previousViewBeforeSettings:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeSettings accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeActivity:\n    | 'terminal'",
        "  previousViewBeforeActivity:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeActivity accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeAutomations:\n    | 'terminal'",
        "  previousViewBeforeAutomations:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeAutomations accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeSpace:\n    | 'terminal'",
        "  previousViewBeforeSpace:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeSpace accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeSkills:\n    | 'terminal'",
        "  previousViewBeforeSkills:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeSkills accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeMobile:\n    | 'terminal'",
        "  previousViewBeforeMobile:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeMobile accepts the tracker",
    ),
    (
        "src/renderer/src/store/slices/ui.ts",
        "  previousViewBeforeArtifacts:\n    | 'terminal'",
        "  previousViewBeforeArtifacts:\n    // PlanIDE: the tracker is a top-level view too.\n    | 'planide'\n    | 'pulse-brain'\n    | 'pulse-design'\n    | 'terminal'",
        "previousViewBeforeArtifacts accepts the tracker",
    ),
    # And the zod enum the persisted UI state is validated against: a compile-time
    # parity assertion in ui-state-schema-parity-checks.ts fails if the schema
    # cannot accept a value the type allows.
    (
        "src/main/runtime/rpc/methods/client-ui-schemas.ts",
        "const STATIC_RIGHT_SIDEBAR_TABS = [\n  'explorer',",
        "const STATIC_RIGHT_SIDEBAR_TABS = [\n"
        "  // PlanIDE: the tracker and the two memory tabs are real sidebar tabs,\n"
        "  // so a client may persist any of them.\n"
        "  'planide',\n  'pulse-brain',\n  'pulse-obsidian',\n  'pulse-design',\n  'explorer',",
        "the tracker is a valid persisted sidebar tab",
    ),
    (
        "src/main/runtime/rpc/methods/client-ui-schemas.ts",
        "const TopLevelViewSchema = z.enum([\n  'terminal',",
        "const TopLevelViewSchema = z.enum([\n  // PlanIDE: the tracker and the two full-page\n  // memory/design surfaces are top-level views.\n  'planide',\n  'pulse-brain',\n  'pulse-design',\n  'terminal',",
        "the tracker is a valid persisted view",
    ),
    (
        "src/shared/top-level-view.ts",
        "const TOP_LEVEL_VIEW_LOOKUP: Record<TopLevelView, true> = {\n  terminal: true,",
        "const TOP_LEVEL_VIEW_LOOKUP: Record<TopLevelView, true> = {\n  terminal: true,\n  planide: true,\n  'pulse-brain': true,\n  'pulse-design': true,",
        "allow 'planide' through the persistence guard",
    ),
    (
        "src/renderer/src/app-shell/AppWorkspaceShell.tsx",
        "      {activeView === 'settings' ? <Settings /> : null}",
        "      {activeView === 'planide' ? <PlanIdeView /> : null}\n      {activeView === 'pulse-brain' ? <PulseMemoryPage /> : null}\n      {activeView === 'pulse-design' ? <PulseDesignPage /> : null}\n      {activeView === 'settings' ? <Settings /> : null}",
        "render the tracker workbench",
    ),
    (
        "src/renderer/src/app-shell/AppWorkspaceShell.tsx",
        "function ActivePage({ layout }: { layout: AppChromeLayout }): React.JSX.Element {",
        "const PlanIdeView = lazy(() => import('../components/planide/PlanIdeView'))\n"
        "const PulseMemoryPage = lazy(() => import('../components/planide/PulseMemoryPage'))\n"
        "const PulseDesignPage = lazy(() => import('../components/planide/PulseDesignPage'))\n\n"
        "function ActivePage({ layout }: { layout: AppChromeLayout }): React.JSX.Element {",
        "lazy-import the tracker workbench",
    ),
    (
        "src/renderer/src/components/sidebar/SidebarNav.tsx",
        "  const skillsActive = activeView === 'skills'",
        "  const skillsActive = activeView === 'skills'\n  const planIdeActive = activeView === 'planide'\n  const pulseBrainActive = activeView === 'pulse-brain'\n  const pulseDesignActive = activeView === 'pulse-design'\n  const setActiveView = useAppStore((s) => s.setActiveView)",
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
      </button>
      {/* Brain Graph and Open Design sit under the tracker: same project, the
          knowledge behind it and the design work on it. */}
      <button
        type="button"
        onClick={() => setActiveView('pulse-brain')}
        aria-current={pulseBrainActive ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
          pulseBrainActive
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
        )}
      >
        <Network
          className={cn('size-4 shrink-0', !pulseBrainActive && 'text-worktree-sidebar-foreground/30')}
          strokeWidth={pulseBrainActive ? 2.25 : 1.75}
        />
        <span className="flex-1">{translate('planide.nav.brain', 'Brain Graph')}</span>
      </button>
      <button
        type="button"
        onClick={() => setActiveView('pulse-design')}
        aria-current={pulseDesignActive ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
          pulseDesignActive
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
        )}
      >
        <PenTool
          className={cn('size-4 shrink-0', !pulseDesignActive && 'text-worktree-sidebar-foreground/30')}
          strokeWidth={pulseDesignActive ? 2.25 : 1.75}
        />
        <span className="flex-1">{translate('planide.nav.design', 'Open Design')}</span>
      </button>""",
        "tracker entry in the left nav",
    ),
    (
        "src/renderer/src/components/sidebar/SidebarNav.tsx",
        "import { Bell, BookOpen, CalendarClock, EyeOff, Files, Search, Smartphone } from 'lucide-react'",
        "import { Bell, BookOpen, CalendarClock, EyeOff, Files, Search, Smartphone } from 'lucide-react'\n"
        "import { Network, PenTool } from 'lucide-react'\n"
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
    # call the CLI or MCP. (Its import ships in the block above.)
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
        "        // PlanIDE: keep graphify + Obsidian per-workspace, for every agent\n"
        "        // (not only Claude's SessionStart hook). Throttled + detached inside.\n"
        "        maybeSyncMemory(worktreeId)\n"
        "      }",
        "record finished agent turns in the tracker",
    ),
    # ---- auto-update: point Orca's own updater at OUR releases ----------- #
    # Orca already ships a full, well-tested electron-updater subsystem. It does
    # not need replacing -- it needs to look at our repo instead of Stably's.
    # These three constants are what decide which releases the app sees.
    # Every channel, not just stable/rc. These three are the dev channels, and
    # upstream points them at stablyai/orca-hourly|daily|adhoc. Left alone, a
    # PulsarIDE user who switches channel would have Orca builds downloaded and
    # installed OVER PulsarIDE -- the worst version of the two apps mixing. We
    # publish one repo, so every channel resolves to it.
    (
        "src/shared/release-channel.ts",
        "export const HOURLY_RELEASE_REPO = 'stablyai/orca-hourly'",
        f"export const HOURLY_RELEASE_REPO = '{RELEASE_REPO}'",
        "dev channel: hourly points at our releases, never Orca's",
    ),
    (
        "src/shared/release-channel.ts",
        "export const DAILY_RELEASE_REPO = 'stablyai/orca-daily'",
        f"export const DAILY_RELEASE_REPO = '{RELEASE_REPO}'",
        "dev channel: daily points at our releases, never Orca's",
    ),
    (
        "src/shared/release-channel.ts",
        "export const ADHOC_RELEASE_REPO = 'stablyai/orca-adhoc'",
        f"export const ADHOC_RELEASE_REPO = '{RELEASE_REPO}'",
        "dev channel: adhoc points at our releases, never Orca's",
    ),
    (
        "src/shared/release-channel.ts",
        "export const MAIN_RELEASE_REPO = 'stablyai/orca'",
        f"export const MAIN_RELEASE_REPO = '{RELEASE_REPO}'",
        "update feed: stable/rc channel points at our releases",
    ),
    (
        "src/main/updater-prerelease-feed.ts",
        "const ATOM_FEED_URL = 'https://github.com/stablyai/orca/releases.atom'",
        f"const ATOM_FEED_URL = 'https://github.com/{RELEASE_REPO}/releases.atom'",
        "update feed: releases atom feed",
    ),
    (
        "src/main/updater-prerelease-feed.ts",
        "const RELEASES_DOWNLOAD_BASE = 'https://github.com/stablyai/orca/releases/download'",
        f"const RELEASES_DOWNLOAD_BASE = 'https://github.com/{RELEASE_REPO}/releases/download'",
        "update feed: release asset download base",
    ),
    (
        "config/electron-builder.config.cjs",
        "  publish: {\n    provider: 'github',\n    owner: 'stablyai',\n    repo: devChannelRepo ?? 'orca',",
        "  publish: {\n    provider: 'github',\n"
        f"    owner: '{RELEASE_OWNER}',\n    repo: devChannelRepo ?? '{RELEASE_NAME}',",
        "publish target: our own GitHub releases",
    ),
    # ---- the agent bundle: ThePunisher agents + skills, packaged ---------- #
    (
        "config/electron-builder.config.cjs",
        "const commonExtraResources = [relayExtraResource, bundledPluginResources, skillFreshnessResources]",
        "const pulsarAgentsResource = { from: 'resources/pulsar-agents', to: 'pulsar-agents' }\n"
        "const commonExtraResources = [relayExtraResource, bundledPluginResources, skillFreshnessResources, pulsarAgentsResource]",
        "ship the ThePunisher agent bundle inside the app",
    ),
    (
        "src/main/index.ts",
        "  registerPlanIdeIpc()",
        "  registerPlanIdeIpc()\n"
        "  // PulsarIDE: pre-install ThePunisher's team leads + skills + memory\n"
        "  // hooks into the shared agent locations, so every CLI agent running\n"
        "  // inside the IDE has them for every project. Deferred so it never delays\n"
        "  // the first window; version-gated so a normal launch pays nothing.\n"
        "  setTimeout(() => {\n"
        "    try {\n"
        "      deployAgentBundle({ resourcesPath: process.resourcesPath, appPath: app.getAppPath() })\n"
        "    } catch {\n"
        "      /* the bundle can never break startup */\n"
        "    }\n"
        "  }, 0)",
        "deploy the agent bundle on launch",
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
    "src/main/planide/memory-sync.ts",
    "src/main/planide/memory-status.ts",
    # Strips invisible AI watermarks out of docs the agents write.
    "src/main/planide/doc-clean.ts",
    "src/main/planide/board-watch.ts",
    "src/main/planide/auto-push.ts",
    "src/main/planide/agent-bundle.ts",
    "src/preload/planide.ts",
    "src/renderer/src/components/right-sidebar/PlanIdePanel.tsx",
    "src/renderer/src/components/right-sidebar/planide-engine-client.ts",
    "src/renderer/src/components/planide/PlanIdeView.tsx",
    "src/renderer/src/components/planide/PlanIdeMark.tsx",
    "src/renderer/src/components/planide/PlanIdeSync.tsx",
    "src/renderer/src/components/planide/PlanIdeBackups.tsx",
    # Pulse memory (Brain Graph + Obsidian): shared by the two sidebar tabs.
    "src/renderer/src/components/planide/PulseMemory.tsx",
    # Full-page versions of the two surfaces above, opened from the left nav.
    "src/renderer/src/components/planide/PulseMemoryPage.tsx",
    "src/renderer/src/components/planide/PulseDesignPage.tsx",
    # OpenDesign: the design engine, driven by whichever agent you are using.
    "src/renderer/src/components/planide/PulseDesign.tsx",
    "src/main/planide/open-design.ts",
    # The PulsarIDE theme: re-declares Orca's own design tokens (nothing
    # upstream is edited). Imported after main.css by the two renderer entry
    # points below, so the later declaration wins.
    "src/renderer/src/assets/pulsar-theme.css",
    # Branding: these replace Orca's own icons, so the packaged app, its
    # installer, the dock and the taskbar all wear the PlanIDE mark. Generated
    # from assets/icon.svg by ide/design/make-icons.mjs -- edit the SVG, re-run
    # that, never hand-edit the binaries.
    "resources/icon.png",
    "resources/icon-dev.png",
    "resources/build/icon.png",
    "resources/build/icon.ico",
    "resources/build/icon.icns",
    # The IN-APP logo (Landing screen, title bar, onboarding, settings all import
    # resources/logo.svg). Without this the whole UI still shows Orca's logo even
    # though the app icon is ours -- the real "I still see the Orca logo" bug.
    "resources/logo.svg",
    # Alternate app-icon choices in Settings > App Icon -- Orca-branded PNGs, so a
    # user who picked one saw an Orca icon. Replaced with pulsar variants.
    "resources/app-icons/orca-watercolor.png",
    "resources/app-icons/orca-blue.png",
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


BUNDLE_SRC = os.path.join(HERE, "agent-bundle")


def copy_bundle(root: str, check_only: bool) -> tuple[int, list[str]]:
    """Copy the whole agent bundle into the checkout's resources so
    electron-builder packages it (see the pulsarAgentsResource edit)."""
    problems: list[str] = []
    if not os.path.isdir(BUNDLE_SRC):
        return 0, ["agent bundle missing from this repo: ide/agent-bundle"]
    if not os.path.isfile(os.path.join(BUNDLE_SRC, "manifest.json")):
        return 0, ["agent bundle has no manifest.json"]
    count = 0
    for dirpath, _dirs, files in os.walk(BUNDLE_SRC):
        for f in files:
            count += 1
    if not check_only:
        dest = os.path.join(root, "resources", "pulsar-agents")
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(BUNDLE_SRC, dest)
    return count, problems


def pulsar_version() -> str | None:
    """PulsarIDE's own version (agent-tools/VERSION), or None if unreadable."""
    path = os.path.join(HERE, "..", "agent-tools", "VERSION")
    try:
        with open(path, encoding="utf-8") as fh:
            v = fh.read().strip()
        return v or None
    except OSError:
        return None


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
    # The app must report OUR version, not Orca's. app.getVersion() is what
    # electron-updater compares against the release feed: shipping Orca's
    # 1.4.178-rc.2 while our releases are tagged v0.20.0 makes every release look
    # like a downgrade, so the updater would silently never offer one. Our own
    # versions increase monotonically, which is exactly what it needs.
    version = pulsar_version()
    if version and data.get("version") != version:
        data["version"] = version
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


# --- inline source-string rebrand ------------------------------------------- #
# patch_locale only reaches strings that live in the locale JSON. Orca's English
# UI, though, overwhelmingly uses inline fallbacks -- translate('auto.x', 'Orca
# ...') whose 'auto.x' key is NOT in en.json (English renders the fallback), plus
# raw literals like setError('Enter an Orca skill share link.'). None of those are
# in the catalogs, so without this the packaged app still says "Orca"/"ORCA" all
# over -- the Landing <h1> is literally translate('auto...', 'ORCA'). This
# rebrands the product name inside the *string literals* of the app source.
SOURCE_ROOTS = ("src/renderer/src", "src/main")

# A few source files are not product branding and must be left alone:
#   plugin-display-name.ts capitalises third-party *plugin* names (a plugin whose
#   slug is "orca" should still display "Orca", not our product name).
SOURCE_SKIP_FILES = ("plugin-display-name.ts",)

# One combined tokenizer. Order matters: comments match BEFORE strings, so an
# apostrophe inside a comment ("Orca's data folder") can never be mistaken for the
# start of a string literal. Only string tokens are rebranded; comments, regex
# literals and code identifiers pass through untouched. Single/double strings stop
# at a newline (JS forbids a raw newline in them), which bounds any mis-tokenised
# span; a substitution only ever swaps Orca->PulsarIDE inside a string, so it can
# never change the file's structure even in the pathological case.
import re as _re  # noqa: E402

_SOURCE_TOKEN_RE = _re.compile(
    r"//[^\n]*"                 # line comment
    r"|/\*[\s\S]*?\*/"          # block comment
    r"|'(?:[^'\\\n]|\\.)*'"     # single-quoted string
    r"|\"(?:[^\"\\\n]|\\.)*\""  # double-quoted string
    r"|`(?:[^`\\]|\\.)*`"       # template literal (may span lines)
)


def _rebrand_source_token(match: "_re.Match[str]") -> str:
    tok = match.group(0)
    if tok[:1] not in ("'", '"', "`"):  # comment -> untouched
        return tok
    if "Orca" not in tok and "ORCA" not in tok:
        return tok
    # Keep the real external Stably service/artifact names verbatim, same as
    # patch_locale (Orca Cloud, Orca Relay, Orca CLI, orca.yaml, ...).
    if any(h in tok for h in LOCALE_SKIP_VALUE_HINTS):
        return tok
    return _rebrand_value(tok)


def patch_source_strings(root: str, check_only: bool) -> int:
    """Rebrand the product name inside string literals of the app source.

    Returns the number of files changed. Idempotent (a second run finds no
    remaining whole-word capital 'Orca' to change) and drift-proof (it scans, it
    does not depend on anchors), the same way patch_locale is.
    """
    changed = 0
    for sub in SOURCE_ROOTS:
        base = os.path.join(root, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            if "/i18n/locales" in dirpath.replace(os.sep, "/"):
                continue
            for f in files:
                if not (f.endswith(".ts") or f.endswith(".tsx")):
                    continue
                if ".test." in f or ".spec." in f or f.endswith(".d.ts"):
                    continue
                if f in SOURCE_SKIP_FILES:
                    continue
                path = os.path.join(dirpath, f)
                text = read(path)
                if "Orca" not in text and "ORCA" not in text:
                    continue
                new = _SOURCE_TOKEN_RE.sub(_rebrand_source_token, text)
                if new != text:
                    changed += 1
                    if not check_only:
                        write(path, new)
    return changed


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
    bundle_files, bundle_problems = copy_bundle(root, check_only)
    applied, skipped, edit_problems = apply_edits(root, check_only)
    pkg_problems = patch_package_json(root, check_only)
    locale_changed, locale_skipped = patch_locale(root, check_only)
    source_changed = patch_source_strings(root, check_only)
    problems = copy_problems + bundle_problems + edit_problems + pkg_problems

    print(f"  overlay files : {copied}")
    print(f"  agent bundle  : {bundle_files} files")
    print(f"  edits applied : {applied}")
    print(f"  already done  : {skipped}")
    print(f"  locale strings: {locale_changed} rebranded, {len(locale_skipped)} left (Orca services)")
    print(f"  source strings: {source_changed} files rebranded (inline Orca -> {PRODUCT})")
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
