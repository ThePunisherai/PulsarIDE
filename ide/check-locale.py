#!/usr/bin/env python3
"""Check the PulsarIDE locale rebrand against a real checkout's English catalog.

The rebrand renames what the app calls *itself* (Orca -> PulsarIDE) while leaving
Orca's genuinely external services (Cloud, Relay, Mobile, account/sign-in, the
`orca` CLI binary, the GitHub star link, orca.yaml) exactly as upstream ships
them -- renaming those would point a user at things that do not exist under the
PulsarIDE name.

    python3 ide/check-locale.py <orca-checkout>

Exits non-zero (naming the problem) if the rebrand under- or over-reaches.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

LEAKS = [
    "PulsarIDE Cloud",
    "PulsarIDE Relay",
    "PulsarIDE Mobile",
    "Star PulsarIDE",
    "Sign in to PulsarIDE",
    "PulsarIDE account",
    "PulsarIDE CLI",
]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check-locale.py <orca-checkout>")
        return 2
    src = os.path.join(sys.argv[1], "src/renderer/src/i18n/locales/en.json")
    if not os.path.isfile(src):
        print(f"no en.json at {src}")
        return 2

    spec = importlib.util.spec_from_file_location("a", os.path.join(HERE, "apply.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    tmp = tempfile.mkdtemp()
    try:
        dst = os.path.join(tmp, "src/renderer/src/i18n/locales")
        os.makedirs(dst)
        shutil.copy2(src, os.path.join(dst, "en.json"))
        changed, skipped = mod.patch_locale(tmp, check_only=False)
        blob = open(os.path.join(dst, "en.json"), encoding="utf-8").read()
        json.loads(blob)  # still valid JSON
    finally:
        shutil.rmtree(tmp)

    problems = []
    if changed < 100:
        problems.append(f"only {changed} strings rebranded -- expected a real pass")
    for leak in LEAKS:
        if leak in blob:
            problems.append(f"an external Orca service got rebranded: {leak!r}")
    if "orca status" not in blob:
        problems.append("the lowercase `orca` CLI command examples did not survive")
    if "Enjoying PulsarIDE?" not in blob:
        problems.append("app-identity strings were not rebranded")

    if problems:
        for p in problems:
            print(f"    {p}")
        return 1
    print(f"ok {changed} rebranded / {len(skipped)} left as Orca services")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
