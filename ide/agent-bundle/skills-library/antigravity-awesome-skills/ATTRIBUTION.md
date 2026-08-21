# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the `skills/` library, `skills_index.json`,
license files, `CATALOG.md`, and `docs/sources/` from:

- **Upstream repo:** https://github.com/sickn33/antigravity-awesome-skills
- **Commit vendored:** `f061e3b4bdeac5dfd64793404eddde91d7821ba2` (refreshed from
  `1e7fd2a679dcea5cb0e78242ce547936d1f9de05`, vendored 2026-07-10 — upstream genuinely grew from
  1,852 to 1,997 skills)
- **Date vendored:** 2026-07-28 (refresh)
- **Skill count at vendor time:** 1,993 indexed entries in `skills_index.json` (1,892 flat
  `skills/<name>` + 101 nested one level deeper under a category directory, e.g.
  `skills/security/<name>` — a layout upstream introduced since the last vendor pass) + 4
  official-alias directories (`docx`, `pdf`, `pptx`, `xlsx` — see below) that aren't separately
  indexed = **1,997 real, deployable skill directories** on disk, verified by cross-checking every
  indexed `path` resolves to a real directory (0 missing) and every real `SKILL.md` file's parent
  directory is accounted for by either the index or the 4 known aliases (0 unexplained). The
  upstream README's own marketing figure may differ — the machine-readable index plus actual
  directory count is the ground truth used here, same convention as the original vendor pass.

## License

- **Code/tooling** (scripts inside individual skill folders, schemas, etc.): MIT — see `LICENSE`.
- **Documentation/content** (the `SKILL.md` files themselves and other written material): CC BY 4.0
  — see `LICENSE-CONTENT`.
- Per-skill upstream provenance (some skills are adapted from Anthropic/Google/OpenAI/Microsoft/
  Supabase/Apify/Vercel Labs official sources, or other third parties, each with their own terms)
  is tracked by the **upstream project itself**, preserved here unmodified in `docs/sources/`. This
  repo does not re-adjudicate per-skill licensing beyond what upstream already documents — it
  mirrors their own published compliance tracking rather than re-deriving it.

## Why this is vendored (not just referenced)

`integrations/skills.json` previously catalogued only the ~42 skills ThePunisher's own persona
doc names explicitly. The upstream registry is far larger (1,852 real skills, verified live via
both `npx skills add --list` and a direct `git clone`, not guessed) and the user explicitly asked
for the full library to be available offline, inside the repo, at install time — not just a live
`npx skills find` bridge. This directory is that: the actual skill content, not a metadata stub.

## One deliberate change from the upstream tree

Upstream ships 7 symlinks (`skills/docx -> docx-official`, `pdf`, `pptx`, `xlsx`, and 3
`CLAUDE.md -> AGENTS.md` files inside `dbos-golang`/`dbos-typescript`/`dbos-python`). Those are
**dereferenced into real file/directory copies** here instead of committed as symlinks: Windows
git checkouts silently turn symlinks into plain-text placeholder files unless `core.symlinks=true`
and Developer Mode/admin rights are set up, which would silently break those 7 skill names on a
lot of real Windows machines. A real copy works everywhere regardless of git configuration —
content is identical either way, only the on-disk representation changed.

## Keeping this in sync

This is a point-in-time snapshot, not an auto-updating mirror. To refresh it:

```bash
git clone --depth 1 https://github.com/sickn33/antigravity-awesome-skills.git /tmp/skills-src
rsync -a --delete /tmp/skills-src/skills/ skills-library/antigravity-awesome-skills/skills/
cp /tmp/skills-src/skills_index.json /tmp/skills-src/CATALOG.md skills-library/antigravity-awesome-skills/
cp -r /tmp/skills-src/docs/sources/. skills-library/antigravity-awesome-skills/docs/sources/
```

Update the commit hash/date above after refreshing.
