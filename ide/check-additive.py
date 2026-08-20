#!/usr/bin/env python3
"""The promise this overlay makes: it ADDS to Orca, it does not take anything away.

Only the branding constants may rewrite an upstream line (Orca -> PlanIDE in the
app name, bundle id, protocol and artifact names). Every other edit must keep
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
