#!/usr/bin/env python3
"""ThePunisher :: task router — the real "automatic based on the request" engine.

Given a free-text task description, scores it against every team's purpose + every
agent's name/role (from agents/roster.json), and against integrations/repos.json and
integrations/skills.json, then returns the ranked teams/agents/repos/skills/tools that
would be activated. This is what the Council's routing step and the dashboard's router
box actually call — not a doc, a working matcher.

Algorithm: plain TF-IDF-ish term overlap (no external deps, no ML, no fabricated
"AI routing" claim) — deterministic, inspectable, testable.

Usage:
    router.py "analyze this binary for vulnerabilities"
    router.py --json "build a react dashboard"        # machine-readable
    router.py --top 3 "fix this flaky test"
"""
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STOP = {
    "the", "a", "an", "to", "of", "for", "and", "or", "in", "on", "is", "this",
    "that", "with", "it", "my", "me", "i", "please", "can", "you", "we", "our",
    "be", "as", "at", "by", "from", "into", "using", "use", "need", "want",
    "how", "what", "does", "do", "help", "trying", "issue", "problem", "so",
    # Found via a live 20-query diagnostic battery (direct response to "maak het nog beter" /
    # the session's repeated "geen fouten maken" ask): these carry zero real topical signal
    # but were leaking through as scored "hits", actively misrouting real queries. "has"/"why"
    # are pure auxiliary/question words -- e.g. "this python script HAS a memory leak" scored
    # a real hit for reverse-engineering purely on "has", nothing about memory/leaks/python.
    # "find" is too generic (find a bug, find a vuln, find a file -- no team owns "finding")
    # and pulled "find SQL injection vulnerabilities" toward reverse-engineering instead of
    # Security & Pentest. "re" is not a real word here -- tokenize()'s regex splits hyphenated
    # words like "re-renders"/"re-run" into "re" + the remainder, and that 2-letter fragment
    # then spuriously collided with "RE" as Reverse Engineering's own abbreviation in its
    # indexed text: "debug why this react component RE-renders infinitely" scored reverse-
    # engineering ahead of the Debug team, entirely off that split-off fragment.
    "has", "why", "find", "re",
    # Direct response to a real-project audit battery (32 diverse queries incl. 5 informal
    # Dutch ones, run to check router quality for the actual user, who types Dutch): "set up
    # a Kubernetes operator that auto-scales pods on custom metrics" lost DevOps & Automation
    # (score 12.32 on kubernetes/metrics, its own real, specific vocabulary) to Reverse
    # Engineering Command (score 20.21, purely off "up"+"auto"+"custom" -- three generic
    # words RE's role text happens to also contain, e.g. "custom packer"/"custom protocol"),
    # confirmed via a per-term score breakdown, not guessed. "operator" was deliberately left
    # OUT of this list even though it also contributed to the same RE win: it's a real,
    # specific term (Kubernetes' own "Operator" pattern) that DevOps's own indexed text simply
    # doesn't happen to use yet -- that's a roster-content gap worth fixing separately, not a
    # router bug to paper over by blanket-stopping a word that carries real meaning elsewhere.
    "up", "auto", "custom",
}

# Direct response to "moet slimmer worden geen fouten maken" (needs to become smarter, make
# no mistakes): pure bag-of-words missed matches on word-form variants -- a query like
# "debugging this" scored 0 against indexed "debug" (Team 6's own purpose/agent text), which
# could silently drop a real match or shift ranking toward an unrelated team that happened to
# share a different word. Deliberately a CURATED lookup, not algorithmic stemming (Porter-
# style suffix stripping risks garbage roots that accidentally collide across unrelated
# words) -- a curated lookup here, not algorithmic stemming.
# Every base word here was checked against ALL 100 teams' indexed text before inclusion
# (not just the "obviously right" team) -- this roster spans 100 sectors, not just software,
# so several tempting words were deliberately LEFT OUT after that check caught them causing
# real misrouting: "build"/"design"/"manage" are too generic and heavily used across nearly
# every team's purpose text to safely collapse; "secure"/"monitor" are dominated by Team
# "Home Security & Alarm Monitoring Technology Engineering", not cybersecurity; "route" is
# dominated by literal delivery/logistics teams, not networking/dispatch; "optimize" is
# dominated by Cloud FinOps and Supply Chain, not code optimization. A live test of "build a
# react dashboard" caught this directly: normalizing "build" pulled the top match from Web
# Design & Frontend to Construction Technology Engineering (also plausible now that this
# roster has real construction-industry teams) -- reverted before it ever shipped.
NORMALIZE = {}
for _base, _forms in {
    "debug": ("debugging", "debugged", "debugs"),
    "test": ("testing", "tested", "tests"),
    "review": ("reviewing", "reviewed", "reviews"),
    "deploy": ("deploying", "deployed", "deploys"),
    "analyze": ("analyzing", "analyzed", "analyzes", "analysis"),
    "hack": ("hacking", "hacked", "hacks"),
    "audit": ("auditing", "audited", "audits"),
    "refactor": ("refactoring", "refactored", "refactors"),
    "scan": ("scanning", "scanned", "scans"),
    "exploit": ("exploiting", "exploited", "exploits", "exploitation"),
    "patch": ("patching", "patched", "patches"),
    "reverse": ("reversing", "reversed"),
    "document": ("documenting", "documented", "documents", "documentation"),
    "integrate": ("integrating", "integrated", "integrates", "integration"),
    "migrate": ("migrating", "migrated", "migrates", "migration"),
    "automate": ("automating", "automated", "automates", "automation"),
    "configure": ("configuring", "configured", "configures", "configuration"),
    "implement": ("implementing", "implemented", "implements", "implementation"),
    "create": ("creating", "created", "creates"),
    "update": ("updating", "updated", "updates"),
    "fix": ("fixing", "fixed", "fixes"),
    "write": ("writing", "writes"),
    # Not a verb-form variant like the rest of this map -- a plain spelling alias. roster.json
    # only ever writes the product's official name "PostgreSQL" (indexed token "postgresql"),
    # but a real user overwhelmingly types the colloquial "postgres" -- confirmed via the same
    # diagnostic battery that "optimize this slow postgres query" matched zero backend/database
    # team text on that word at all, since "postgres" and "postgresql" are different tokens to
    # exact bag-of-words matching.
    "postgresql": ("postgres",),
}.items():
    for _f in _forms:
        NORMALIZE[_f] = _base

# Multi-language technical-verb glossaries. Started as a Dutch-only block (the actual end
# user of this repo communicates informally in Dutch, and STOP/NORMALIZE above were 100%
# English tokens -- a Dutch technical query with no English loanwords resolved to a
# confident, garbage top-1 team, e.g. "los dit segfault probleem op in mijn C programma"
# matched "Franchise Business Operations" purely because the Dutch word "op" happened to
# substring-collide inside "Co-Op" in that team's own agent name -- not a graceful "no
# match", an actively WRONG confident answer). Refactored into LANG_GLOSSARIES (direct
# response to "Ik wil multi lang supported") so adding a language is one dict entry, not a
# copy-pasted block. Every mapping in every language below ONLY reuses an EXISTING,
# already-vetted English base form from the map above (debug/test/analyze/etc.) -- the same
# reasoning as the plain "postgres" alias, just extended across languages instead of
# spellings; no language glossary introduces a NEW ambiguous base word the English map
# itself doesn't already trust. A live test battery (same discipline as the rest of this
# file, see scripts/test-router.py) was run per language before shipping, and real risks
# were found and excluded, not guessed at:
# - Dutch: "maak"/"maken" (create) was left out -- Dutch's true equivalent is closer to
#   generic "build/make" (already excluded above for over-triggering) and is used
#   constantly in totally unrelated daily speech ("maak een foto" = take a photo).
# - Every language: a foreign source word that's IDENTICAL to a real, unrelated English
#   word already meaningful elsewhere was deliberately skipped rather than silently
#   overwritten -- e.g. French "configure"/"integre" are spelled close to but not
#   identical to their English cousins and were kept; anything that WOULD collide with an
#   existing distinct English token (like the agent-name noun "debugger", which several
#   languages casually verb into "debugger le systeme"/"debuggen"-adjacent forms) was
#   deliberately left unmapped so the existing literal English match keeps working.
# A separate, real limitation NONE of these glossaries can fix: languages with separable
# verbs split a prefix to the end of the clause (Dutch "los ... op" = "fix", not one word;
# German has the identical pattern, e.g. "beheben" is NOT separable and stays safe, but
# many other German fix/solve verbs ARE) -- token-level matching has no way to recombine a
# split verb from opposite ends of a sentence, so that exact phrasing still won't resolve
# (only the contiguous infinitive/participle/noun forms do). This is the same class of
# accepted, honestly-documented limitation as the "train a classifier" word-sense-ambiguity
# case elsewhere in this file's history -- a lexical matcher cannot fully parse a language's
# grammar, and pretending otherwise here would be worse than leaving it uncovered. Accented
# characters are also a real, structural gap: tokenize()'s regex only matches [a-z0-9], so
# any form needing an accent to be correctly spelled (French "déboguer", German "gelöst")
# is intentionally NOT listed below even where the correctly-accented word would otherwise
# be safe to add -- an accented form would just fragment into garbage sub-tokens at the
# accent, so only genuinely ASCII-safe forms (including how a user informally typing without
# diacritics, common on non-native keyboards/mobile, would actually type it) are included.
LANG_GLOSSARIES = {
    "nl": {  # Dutch
        "debug": ("debuggen", "debugt", "gedebugd"),
        "test": ("testen", "getest"),
        "deploy": ("deployen", "gedeployed"),
        "analyze": ("analyseer", "analyseren", "geanalyseerd"),
        "hack": ("hacken", "gehackt"),
        "audit": ("auditen", "geaudit"),
        "refactor": ("refactoren", "gerefactored"),
        "scan": ("scannen", "gescand"),
        "exploit": ("exploiteren", "geexploiteerd"),
        "patch": ("patchen", "gepatcht"),
        "document": ("documenteer", "documenteren", "gedocumenteerd"),
        "integrate": ("integreer", "integreren"),
        "migrate": ("migreer", "migreren", "gemigreerd"),
        "automate": ("automatiseer", "automatiseren", "geautomatiseerd"),
        "configure": ("configureer", "configureren", "geconfigureerd"),
        "implement": ("implementeer", "implementeren"),
        "update": ("updaten", "geupdatet"),
        # oplossen/opgelost/oplossing are the contiguous infinitive/participle/noun forms of
        # the separable verb "oplossen" (los ... op) -- these DO work via plain token
        # matching even though the present-tense split form ("los ... op") doesn't.
        "fix": ("fixen", "gefixt", "oplossen", "opgelost", "oplossing"),
        "write": ("schrijf", "schrijven", "geschreven"),
    },
    "de": {  # German. Includes the informal du-imperative for every verb (e.g. "debugge!",
        # "behebe das!") since this router's queries are inherently command-style ("fix
        # this", "test that") -- confirmed live that the imperative is at least as common a
        # real form as the infinitive for exactly this reason, not guessed after the fact.
        "debug": ("debuggen", "debuggt", "gedebuggt", "debugge"),
        "test": ("testen", "testet", "getestet", "teste"),
        "deploy": ("deployen", "deployt", "gedeployt", "deploye"),
        "analyze": ("analysieren", "analysiert", "analysiere"),
        "hack": ("hacken", "hackt", "gehackt", "hacke"),
        "audit": ("auditieren", "auditiere"),
        "refactor": ("refactoren", "refactort", "refactore"),
        "scan": ("scannen", "scannt", "gescannt", "scanne"),
        "exploit": ("exploiten", "exploite"),
        "patch": ("patchen", "patcht", "gepatcht", "patche"),
        "document": ("dokumentieren", "dokumentiert", "dokumentiere"),
        "integrate": ("integrieren", "integriert", "integriere"),
        "migrate": ("migrieren", "migriert", "migriere"),
        "automate": ("automatisieren", "automatisiert", "automatisiere"),
        "configure": ("konfigurieren", "konfiguriert", "konfiguriere"),
        "implement": ("implementieren", "implementiert", "implementiere"),
        "update": ("updaten", "aktualisieren", "aktualisiert", "aktualisiere"),
        # "beheben" (to fix/resolve) is NOT a separable verb -- its "be-" prefix never
        # splits off, so unlike many other German fix/solve verbs it's safe here.
        "fix": ("fixen", "gefixt", "beheben", "behoben", "behebe"),
        "write": ("schreiben", "geschrieben", "schreibe"),
    },
    "es": {  # Spanish. Includes the informal tu-imperative for every verb (e.g. "depura
        # esto!", "arregla esto!") for the same reason as German above -- command-style
        # phrasing is at least as likely as the infinitive for a task-routing query.
        # "prueba"/"pruebas" is also added under "test": the native Spanish noun for
        # "test"/"tests" ("pruebas unitarias" = "unit tests") is far more common in real
        # usage than the "testear" loanword verb alone would cover.
        "debug": ("depurar", "depurando", "depurado", "debuggear", "depura"),
        "test": ("testear", "testeando", "testeado", "testea", "prueba", "pruebas"),
        "deploy": ("desplegar", "desplegando", "desplegado", "deployar", "despliega"),
        "analyze": ("analizar", "analizando", "analizado", "analiza"),
        "hack": ("hackear", "hackeando", "hackeado", "hackea"),
        "audit": ("auditar", "auditando", "auditado", "audita"),
        "refactor": ("refactorizar", "refactorizando", "refactoriza"),
        "scan": ("escanear", "escaneando", "escaneado", "escanea"),
        "exploit": ("explotar", "explotando", "explota"),
        "patch": ("parchear", "parcheando", "parcheado", "parchea"),
        "document": ("documentar", "documentando", "documentado", "documenta"),
        "integrate": ("integrar", "integrando", "integrado", "integra"),
        "migrate": ("migrar", "migrando", "migrado", "migra"),
        "automate": ("automatizar", "automatizando", "automatizado", "automatiza"),
        "configure": ("configurar", "configurando", "configurado", "configura"),
        "implement": ("implementar", "implementando", "implementado", "implementa"),
        "update": ("actualizar", "actualizando", "actualizado", "actualiza"),
        "fix": ("arreglar", "arreglando", "arreglado", "arregla",
                "solucionar", "solucionando", "soluciona"),
        "write": ("escribir", "escribiendo", "escribe"),
    },
    "fr": {  # French -- deliberately thinner: most correctly-spelled French tech-verb
        # conjugations need an accent (déboguer, déployer, intégrer...) that tokenize()'s
        # ASCII-only regex can't handle, so only forms that are genuinely accent-free even
        # when spelled correctly, or common enough informally-typed-without-accents that a
        # real user plausibly types them that way, are listed.
        "test": ("tester", "teste"),
        "deploy": ("deployer", "deploie"),
        "analyze": ("analyser", "analyse"),
        "hack": ("hacker", "hacke"),
        "audit": ("auditer", "audite"),
        "refactor": ("refactoriser", "refactorise"),
        "scan": ("scanner", "scanne"),
        "exploit": ("exploiter", "exploite"),
        "patch": ("patcher", "patche"),
        "document": ("documenter", "documente"),
        "integrate": ("integrer", "integre"),
        "migrate": ("migrer", "migre"),
        "automate": ("automatiser", "automatise"),
        "configure": ("configurer",),
        "implement": ("implementer", "implemente"),
        "update": ("mettreajour",),
        "fix": ("fixer", "corriger", "reparer"),
        "write": ("ecrire", "redige"),
    },
}
for _lang, _lang_map in LANG_GLOSSARIES.items():
    for _base, _forms in _lang_map.items():
        for _f in _forms:
            NORMALIZE[_f] = _base

# See the name-bonus comment in route() for the full story: a team-name word can be a unique
# identifier (no other team's name contains it) while still being an ordinary English noun with
# everyday meaning unrelated to that sector. "water" is proven live-risky (see git history/
# CHANGELOG); add more here only after a live case actually demonstrates the same failure, not
# preemptively.
NAME_BONUS_EXCLUDE = {"water"}


def tokenize(text):
    words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]
    return [NORMALIZE.get(w, w) for w in words]


def load(name):
    return json.load(open(os.path.join(ROOT, name)))


def build_index():
    roster = load("agents/roster.json")
    repos = load("integrations/repos.json")
    skills = load("integrations/skills.json")
    plugins = load("tools/reverse-engineering/plugins.json")

    team_bag = {}   # slug -> {token: weight}
    team_meta = {}  # slug -> {name, num, purpose, agents:[{name,role}]}
    team_name_tokens = {}  # slug -> {token, ...} from the team's own name only
    for t in roster["teams"]:
        # Growth-pool agents (roster.json's per-team "growth_agents") are merged into the
        # SAME routable pool as the core roster here. They are never individually deployed
        # as Claude Code/Gemini CLI/Codex subagent files (see deploy_teams_and_mcp()'s
        # token-budget note in install.sh) -- but this script runs standalone (a CLI call or
        # the dashboard's router box), never injected into a session's own context budget, so
        # there's no cost to indexing all of them here. This is what keeps growth agents
        # "still fully findable via Council" true instead of a dangling claim.
        all_agents = t["agents"] + t.get("growth_agents", [])
        name_toks = tokenize(t["name"])
        toks = tokenize(t["purpose"]) + name_toks
        for a in all_agents:
            toks += tokenize(a["name"].replace("ThePunisher-", "")) + tokenize(a["role"])
        bag = {}
        for w in toks:
            bag[w] = bag.get(w, 0) + 1
        team_bag[t["slug"]] = bag
        team_name_tokens[t["slug"]] = set(name_toks)
        team_meta[t["slug"]] = {
            "num": t["num"], "name": t["name"], "purpose": t["purpose"],
            "agents": all_agents,
        }

    repo_by_team = {}
    for items in repos["categories"].values():
        for it in items:
            for slug in it["teams"]:
                repo_by_team.setdefault(slug, []).append(it["repo"])

    skill_by_team = {}
    for s in skills["skills"]:
        for slug in s["teams"]:
            skill_by_team.setdefault(slug, []).append(s["name"])

    return team_bag, team_meta, repo_by_team, skill_by_team, plugins, team_name_tokens


def route(query, top=5):
    team_bag, team_meta, repo_by_team, skill_by_team, plugins, team_name_tokens = build_index()
    q_tokens = tokenize(query)
    if not q_tokens:
        return {"query": query, "matches": []}

    # doc frequency across teams for a light idf weighting
    df = {}
    for bag in team_bag.values():
        for w in bag:
            df[w] = df.get(w, 0) + 1
    n_teams = max(len(team_bag), 1)

    # How many teams' own NAME contains word w -- gates the name-match bonus below. Most of
    # this 100-team roster follows an "X Technology Engineering" naming convention, so
    # "engineering"/"technology" alone sit in the name of ~88/45 teams respectively -- giving
    # THOSE a name-bonus would be backwards (found via the same diagnostic battery: it briefly
    # sent "refactor this god-class into smaller services" to "Home Services & Field Service
    # Management" purely because "services" is in that team's own name, nothing to do with
    # code refactoring). Only words that are near-unique team-name identifiers (like
    # "brainstorm", "debug", "pentest") should get the bonus.
    name_df = {}
    for toks in team_name_tokens.values():
        for w in toks:
            name_df[w] = name_df.get(w, 0) + 1

    scores = []
    for slug, bag in team_bag.items():
        score = 0.0
        hits = []
        for w in q_tokens:
            if w in bag:
                idf = math.log((n_teams + 1) / (df.get(w, 1) + 0.5)) + 1
                # Sublinear TF scaling (1 + log(tf) instead of raw tf) -- a standard,
                # well-established IR technique, not a curated fix like NORMALIZE above.
                # Found via a live test of "reviewing this pull request for security
                # issues": raw tf let "Home Security & Alarm Monitoring Technology
                # Engineering" (which repeats "security" in nearly every one of its ~50
                # agent role descriptions -- tf=27, since that word IS its whole domain)
                # outscore "Security & Pentest" and "Blue Team & Defensive Security
                # Operations" (which use more varied vocabulary -- pentest, vulnerability,
                # exploit -- so a lower raw tf on the one word "security" despite being the
                # actually relevant teams). This is a real, pre-existing bug, not something
                # this session's NORMALIZE change introduced -- confirmed by reproducing it
                # with NORMALIZE reverted. Sublinear scaling caps how much a team can win
                # purely by repetition of one common word: log(27)=3.3 vs log(8)=2.1, a
                # ~1.6x gap instead of raw tf's 3.4x, letting breadth of genuinely matched
                # terms compete fairly against depth on a single word.
                term_score = (1 + math.log(bag[w])) * idf
                # Team-name bonus: a query word that IS literally part of the team's own name
                # (e.g. "brainstorm" for "Brainstorm & Ideation", "debug" for "Debug &
                # Diagnosis") is about as unambiguous a signal as this matcher can ever see --
                # a user naming the team directly. Without this, that single strong signal
                # could still lose to several weaker, coincidental word matches from an
                # unrelated team's larger 50-100-agent role-text vocabulary. Found via the
                # same diagnostic battery: "brainstorm 3 architectures for a real-time chat
                # app" lost the Brainstorm team entirely to a dating-app team that matched on
                # "real"/"time"/"app" -- generic words with no real connection to brainstorming.
                # 2.5x is deliberately not huge -- still just a weighted term, not an override,
                # so a truly better semantic fit from another team can still win. Gated to
                # near-unique name words only (name_df <= 1: no OTHER team's name also
                # contains it) -- see the name_df comment above for why that gate is required.
                # Also gated against NAME_BONUS_EXCLUDE: a team-name word can be a genuinely
                # unique IDENTIFIER (name_df==1) while still being an ordinary English noun
                # with everyday meaning outside that sector -- "water" is unique to "Water &
                # Wastewater Utility" but describes no activity/task, unlike "brainstorm" or
                # "pentest" which are specific enough that saying them basically always means
                # the team. Found the concrete failure live: "write GLSL shader code for a
                # water ripple effect" (a graphics query, zero utility-sector intent) jumped
                # Water & Wastewater to #1 on the single word "water" alone, ahead of Coding/
                # RE's three genuinely on-topic matches (write/shader/code). Curated exclusion,
                # same precedent as the NORMALIZE list above -- add here only after a live case
                # actually proves it risky, not preemptively for every sector name that happens
                # to double as a common noun.
                if (w in team_name_tokens.get(slug, ()) and name_df.get(w, 0) <= 1
                        and w not in NAME_BONUS_EXCLUDE):
                    term_score *= 2.5
                score += term_score
                hits.append(w)
        if score > 0:
            scores.append((score, slug, hits))

    scores.sort(key=lambda x: -x[0])
    matches = []
    for score, slug, hits in scores[:top]:
        meta = team_meta[slug]
        # rank agents within the team by how many hit-words appear in their role/name
        ranked_agents = sorted(
            meta["agents"],
            key=lambda a: -sum(1 for h in hits if h in tokenize(a["name"] + " " + a["role"])),
        )
        matches.append({
            "team_slug": slug,
            "team_num": meta["num"],
            "team_name": meta["name"],
            "score": round(score, 2),
            "matched_terms": hits,
            # Top 5, not 3 -- each team now holds 50 agents (v1.18.0), so 3 risked
            # missing genuinely relevant specialists that a smaller pre-expansion
            # roster wouldn't have needed as much headroom for.
            "top_agents": [a["name"] for a in ranked_agents[:5]],
            "repos": repo_by_team.get(slug, [])[:5],
            "skills": skill_by_team.get(slug, [])[:5],
        })

    result = {"query": query, "matches": matches}
    if matches and matches[0]["team_slug"] == "reverse-engineering":
        result["re_plugins"] = [p["name"] for p in plugins if p.get("enabled")]
    return result


def main():
    argv = sys.argv[1:]
    as_json = "--json" in argv
    if as_json:
        argv.remove("--json")
    top = 5
    if "--top" in argv:
        i = argv.index("--top")
        top = int(argv[i + 1])
        del argv[i:i + 2]
    query = " ".join(argv)
    if not query:
        print("usage: router.py [--json] [--top N] <task description>", file=sys.stderr)
        sys.exit(2)

    result = route(query, top=top)
    if as_json:
        print(json.dumps(result, indent=2))
        return
    if not result["matches"]:
        print("no team matched — dispatching to Council for manual triage")
        return
    print('Task: "%s"\n' % query)
    for m in result["matches"]:
        print("Team %-2d %-24s score=%-6s agents: %s" % (
            m["team_num"], m["team_name"], m["score"], ", ".join(m["top_agents"])))
        if m["repos"]:
            print("           repos:  %s" % ", ".join(m["repos"]))
        if m["skills"]:
            print("           skills: %s" % ", ".join(m["skills"]))
    if "re_plugins" in result:
        print("\nx64dbg plugins enabled: %s" % ", ".join(result["re_plugins"]))


if __name__ == "__main__":
    main()
