#!/usr/bin/env python3
"""The promise this overlay makes: it ADDS to Orca, it does not take anything away.

Only the branding constants may rewrite an upstream line (Orca -> PlanIDE in the
app name, bundle id, protocol, artifact names and the release feed). Every other edit must keep
each line of its anchor, so no Orca feature can be quietly deleted by an edit
that looked like an improvement.

Exits non-zero, naming the edit, if that ever stops being true.
"""

from __future__ import annotations

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BRANDING = {
    "src/main/startup/dev-instance-identity.ts",
    "config/electron-builder.config.cjs",
    # Release identity: which product's releases this app updates from and
    # publishes to. Same category as the app name and bundle id -- pointing the
    # updater at Orca's releases would hand our users Orca builds.
    "src/shared/release-channel.ts",
    "src/main/updater-prerelease-feed.ts",
    # updater.ts holds the two feed URLs electron-updater is actually pointed
    # at -- the startup one and the no-newer-release fallback. Both are release
    # identity, not behaviour: there is nothing upstream to keep verbatim,
    # because keeping it verbatim is the bug.
    "src/main/updater.ts",
    # Window/taskbar titles: the product name, nothing else.
    "src/renderer/index.html",
    "src/renderer/popout.html",
    "src/renderer/web-index.html",
    # Home-directory identity: which app's ~/.<name> this instance owns. Orca
    # shares ~/.orca across its own instances on purpose; a DIFFERENT app doing
    # the same silently takes over every agent's hook launchers. Swapping the
    # directory is the same category as the app name -- there is nothing to keep
    # verbatim, the whole point is that it must differ.
    "src/main/agent-hooks/installer-utils.ts",
    "src/main/agent-hooks/managed-hook-install-lock.ts",
    "src/main/runtime/claude-agent-teams-shim-env.ts",
    "src/relay/workspace-session-handler.ts",
    "src/main/grok/grok-hook-owners.ts",
    "src/main/orcad/orcad-app-paths.ts",
}


def main() -> int:
    spec = importlib.util.spec_from_file_location("a", os.path.join(HERE, "apply.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    offenders = []
    for rel, anchor, replacement, desc in mod.EDITS:
        kept = replacement.split("\n")
        lost = [l for l in anchor.split("\n") if l.strip() and l not in kept]
        if lost and rel not in BRANDING:
            offenders.append((rel, desc, lost))

    for rel, desc, lost in offenders:
        print(f"    {rel}: {desc}")
        for line in lost:
            print(f"      drops: {line.strip()[:90]}")
    return 1 if offenders else 0


if __name__ == "__main__":
    raise SystemExit(main())
