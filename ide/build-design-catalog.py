#!/usr/bin/env python3
"""Regenerate design-systems/catalog.json from the DESIGN.md files themselves.

`design_find` searches this catalogue, so whatever is not in here cannot be
found. The first version carried only title/category/summary, which meant
"make it look like a bank" missed `wise` (its summary says "Money transfer",
never "banking") and "sports fitness tracker" missed `nike` (its summary says
"Athletic retail"). Both words DO appear in the DESIGN.md prose, so the fix is
to harvest from there rather than to hand-write synonyms forever.

Harvesting everything would be just as useless in the other direction: every
system talks about typography, colour and spacing, so those terms match all 152
and discriminate nothing. Keywords are therefore kept only when they are
DISTINCTIVE -- present in at most DF_MAX of the systems -- which is the same
rarity idea `scripts/router.py` already uses for team routing.

Run it after adding or refreshing a design system; ide/verify.sh fails on drift.
"""
import json
import pathlib
import re
import sys
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = ROOT / 'ide/agent-bundle/design/design-systems'
DF_MAX_RATIO = 0.20          # a term in >20% of systems describes design in general
KEYWORDS_PER_SYSTEM = 24

STOP = {
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'its', 'into', 'are', 'but', 'not',
    'all', 'can', 'has', 'have', 'they', 'their', 'them', 'been', 'was', 'were', 'more',
    'most', 'other', 'than', 'then', 'over', 'under', 'between', 'across', 'while', 'where',
    'when', 'what', 'which', 'each', 'every', 'both', 'same', 'such', 'only', 'also', 'very',
    'much', 'many', 'some', 'any', 'one', 'two', 'three', 'stays', 'stay', 'keeps', 'keep',
    'uses', 'use', 'used', 'using', 'without', 'within', 'through', 'about', 'design',
    'system', 'systems', 'inspired', 'visual', 'interface', 'interfaces',
    # connective prose that survives the rarity filter without describing anything
    'allowing', 'allows', 'establishes', 'establishing', 'execution', 'ignore', 'grow',
    'demand', 'half', 'rather', 'instead', 'become', 'becomes', 'making', 'makes', 'give',
    'gives', 'given', 'almost', 'enough', 'still', 'never', 'always', 'often', 'across',
    'result', 'results', 'means', 'meaning', 'whole', 'entire', 'range', 'sense', 'part',
    'parts', 'place', 'places', 'level', 'levels', 'thing', 'things', 'work', 'works',
    # these files are generated analyses, and their caveat vocabulary describes the
    # ANALYSIS rather than the design: "flows are unresolved", "observed on the
    # analyzed pages". Harvesting it made a motorsport system match a tax ledger.
    'observed', 'unresolved', 'confirmed', 'analyzed', 'analysed', 'exceptions',
    'mostly', 'subject', 'tentative', 'treat', 'treated', 'account', 'accounts',
    'backs', 'follow', 'following', 'remains', 'remain', 'introduce', 'introduces',
}


def is_noise(word: str) -> bool:
    """Hex fragments read as words: `f5f5f7`, `ed760`, `e0f0c`. They are colour
    values lifted out of the prose, they match nothing a human would type, and
    they are rare by construction so the rarity filter keeps every one of them."""
    return bool(re.fullmatch(r'[0-9a-f]{3,8}', word)) or any(c.isdigit() for c in word)


def prose(text: str) -> str:
    """The signal-dense head: the summary blockquote, the opening atmosphere
    paragraphs and the Key Characteristics bullets. Section 2 onwards is colour
    tables and type scales -- shared vocabulary that describes every system
    equally, so harvesting it only adds noise."""
    cut = re.search(r'^##\s*2\.', text, re.M)
    head = text[: cut.start()] if cut else text[:6000]
    chars = re.search(r'\*\*Key Characteristics:?\*\*(.*)', head, re.S)
    intro = head[: chars.start()] if chars else head
    # the bullets are the most descriptive sentences in the file: count them twice
    return intro + (chars.group(1) * 2 if chars else '')


def terms(text: str):
    for w in re.findall(r'[a-z][a-z0-9-]{2,}', text.lower()):
        w = w.strip('-')
        if len(w) > 3 and w not in STOP and not is_noise(w):
            yield w


def main() -> int:
    systems = sorted(p.name for p in DIR.iterdir() if (p / 'DESIGN.md').is_file())
    if not systems:
        print('no design systems found', file=sys.stderr)
        return 1

    local = {}
    for name in systems:
        text = (DIR / name / 'DESIGN.md').read_text(encoding='utf-8', errors='replace')
        local[name] = Counter(terms(prose(text)))

    df = Counter()
    for counts in local.values():
        df.update(counts.keys())
    df_max = max(2, int(len(systems) * DF_MAX_RATIO))

    catalog = {}
    for name in systems:
        text = (DIR / name / 'DESIGN.md').read_text(encoding='utf-8', errors='replace')
        head = text[:1800]
        title = (re.search(r'^#\s+(.+)$', head, re.M) or [None, name])[1].strip()
        cat = re.search(r'^>\s*Category:\s*(.+)$', head, re.M)
        quotes = [q.strip() for q in re.findall(r'^>\s*(.+)$', head, re.M)]
        desc = next((q for q in quotes if not q.lower().startswith('category:')), '')
        # distinctive first, then by how much this system leans on the word
        scored = [
            (cnt * (1.0 / df[w]), w)
            for w, cnt in local[name].items()
            if df[w] <= df_max
        ]
        scored.sort(key=lambda x: (-x[0], x[1]))
        catalog[name] = {
            'title': title,
            'category': cat.group(1).strip() if cat else '',
            'description': desc,
            'keywords': sorted(w for _, w in scored[:KEYWORDS_PER_SYSTEM]),
            'tokens_css': (DIR / name / 'tokens.css').is_file(),
        }

    out = DIR / 'catalog.json'
    out.write_text(
        json.dumps(catalog, indent=1, ensure_ascii=False, sort_keys=True) + '\n',
        encoding='utf-8',
    )
    print(f'{len(catalog)} systems; distinctive-term cutoff df<={df_max}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
