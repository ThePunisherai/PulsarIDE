# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the `skills/` directory, `LICENSE`, and
`README.md` from:

- **Upstream repo:** https://github.com/coreyhaines31/marketingskills
- **Commit vendored:** `7868cb9251fad80a73d26e488a5ad5f6c4a9f335`
- **Date vendored:** 2026-07-28
- **Skill count at vendor time:** 49 (real count, counting real skill directories — the
  upstream README's own "60+" claim is a rounded figure, not the actual directory count)
- **License:** MIT — see `LICENSE`.

## Why this is vendored

Real skill content covering CRO, copywriting, SEO, analytics, growth, and RevOps — this repo
had no dedicated marketing skill library before this. Clean MIT license, no security concerns.

## Name collisions with existing vendored libraries

27 of the 49 skill names collide with skills already vendored (mostly
`alirezarezvani-claude-skills`' own marketing domain, e.g. `ab-testing`, `copywriting`, `cro`,
`seo-audit`). Both copies are kept here since they're different content from different authors,
but only one can occupy `~/.claude/skills/<name>/` at a time. This library is registered LAST in
`install.sh`/`Install.ps1`'s search order (vendored after every other library already present),
so an earlier-vendored library's skill of the same name wins the slot — first-vendored-wins, not
a quality judgment, same convention as every other collision in this repo. 22 names are
genuinely net-new.

## Keeping this in sync

```bash
git clone --depth 1 https://github.com/coreyhaines31/marketingskills.git /tmp/marketingskills-src
rsync -a --delete /tmp/marketingskills-src/skills/ skills-library/coreyhaines31-marketingskills/skills/
cp /tmp/marketingskills-src/LICENSE /tmp/marketingskills-src/README.md skills-library/coreyhaines31-marketingskills/
```

Update the commit hash/date above after refreshing.
