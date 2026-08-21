#!/usr/bin/env python3
"""Regenerate ide/agent-bundle/ from a ThePunisher-Agent checkout.

Usage: ide/sync-agent-bundle.py /path/to/ThePunisher-Agent

Why this exists: the bundle used to be hand-assembled and drifted to v1.67.0 while
ThePunisher-Agent shipped v1.77.0. This makes the bundle a DERIVED artifact -- run it after
pulling a new ThePunisher-Agent and the IDE ships exactly what the agent system does.

The whole roster is bundled, but NOTHING here decides what registers natively -- the deploy
code (agent-bundle.ts) registers only the 15 core team leads + curated skills; everything else
travels as on-disk DATA the Council skill / router reaches on demand (zero context cost). That
is how "all agents + all skills pre-built in" coexists with Claude Code's ~15k description budget.
"""
import json, os, shutil, sys

def rmtree(p):
    if os.path.isdir(p): shutil.rmtree(p)

def copytree(src, dst):
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True)
        return sum(len(fs) for _, _, fs in os.walk(dst))
    return 0

def main():
    if len(sys.argv) < 2:
        sys.exit("usage: sync-agent-bundle.py /path/to/ThePunisher-Agent")
    SRC = os.path.abspath(sys.argv[1])
    BUNDLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent-bundle")
    src_version = open(os.path.join(SRC, "VERSION")).read().strip()

    # 1. Team leads (all 100) -- agents/. Core-vs-vertical is decided at deploy time.
    rmtree(os.path.join(BUNDLE, "agents"))
    n_leads = copytree(os.path.join(SRC, "agents", "teams"), os.path.join(BUNDLE, "agents"))

    # 2. Specialists + growth + vendored agents -> as DATA (never native).
    rmtree(os.path.join(BUNDLE, "specialists"))
    n_spec = copytree(os.path.join(SRC, "agents", "subagents"), os.path.join(BUNDLE, "specialists"))
    n_grow = copytree(os.path.join(SRC, "agents", "subagents-growth"),
                      os.path.join(BUNDLE, "specialists", "_growth"))
    rmtree(os.path.join(BUNDLE, "vendored-agents"))
    n_vend = copytree(os.path.join(SRC, "agents-library"), os.path.join(BUNDLE, "vendored-agents"))

    # 3. Skills: curated (deployed native) stay in skills/; the FULL library ships as data.
    rmtree(os.path.join(BUNDLE, "skills-library"))
    n_sklib = copytree(os.path.join(SRC, "skills-library"), os.path.join(BUNDLE, "skills-library"))

    # 3b. Prune demo/benchmark media ballast: the bundle ships each skill's
    # instructions + code, not gigabytes of sample jpegs/mp3/gif or swebench
    # result dumps. This is the one place the bundle intentionally diverges from
    # the source (keeps the IDE repo from ballooning ~146M -> git). Everything
    # functional (md, py, sh, json config, references, schemas, fonts) is kept.
    import fnmatch
    sklib = os.path.join(BUNDLE, "skills-library")
    MEDIA = ("*.jpeg","*.jpg","*.png","*.gif","*.mp3","*.mp4","*.mov","*.webm")
    for dirpath, dirnames, filenames in os.walk(sklib, topdown=True):
        # drop benchmark result dumps wholesale
        if os.path.basename(dirpath) == "results" and "benchmarks" in dirpath:
            shutil.rmtree(dirpath); dirnames[:] = []; continue
        for fn in filenames:
            if any(fnmatch.fnmatch(fn.lower(), pat) for pat in MEDIA):
                os.remove(os.path.join(dirpath, fn))
    n_sklib = sum(len(fs) for _, _, fs in os.walk(sklib))

    # 4. roster.json + router so the Council can resolve any team/agent by name offline.
    os.makedirs(os.path.join(BUNDLE, "routing"), exist_ok=True)
    for rel in [("agents", "roster.json"), ("scripts", "router.py")]:
        s = os.path.join(SRC, *rel)
        if os.path.isfile(s):
            shutil.copy2(s, os.path.join(BUNDLE, "routing", rel[-1]))

    # 5. Stamp the manifest.
    mpath = os.path.join(BUNDLE, "manifest.json")
    m = json.load(open(mpath))
    m["source_version"] = src_version
    m["team_leads"] = len([f for f in os.listdir(os.path.join(BUNDLE, "agents"))
                           if f.endswith(".md") and f.lower() != "readme.md"])
    m["specialists_on_disk"] = n_spec + n_grow
    m["vendored_agents_on_disk"] = n_vend
    m["skills_library_files"] = n_sklib
    json.dump(m, open(mpath, "w"), indent=2, ensure_ascii=False); open(mpath,"a").write("\n")

    print(f"synced from ThePunisher-Agent {src_version}")
    print(f"  team leads: {m['team_leads']}  specialists+growth: {n_spec+n_grow}  "
          f"vendored agents: {n_vend}  skills-library files: {n_sklib}")

if __name__ == "__main__":
    main()
