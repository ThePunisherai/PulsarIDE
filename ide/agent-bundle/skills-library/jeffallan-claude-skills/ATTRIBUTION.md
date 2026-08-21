# Vendored copy — attribution & provenance

This directory is a **verbatim, unmodified copy** of the `skills/` directory, `LICENSE`, and
`README.md` from:

- **Upstream repo:** https://github.com/jeffallan/claude-skills
- **Commit vendored:** `e8be415bc94d8d6ebddc2fb50e5d03c6e27d4319`
- **Date vendored:** 2026-07-10
- **Skill count at vendor time:** 66 (verified by counting real skill directories, matches
  upstream's own "66 Specialized Skills for Full-Stack Developers" claim)
- **License:** MIT — see `LICENSE`.

## Name collisions with skills-library/antigravity-awesome-skills/

16 skill names exist in both vendored libraries (`api-designer`, `cloud-architect`,
`code-reviewer`, `cpp-pro`, `database-optimizer`, `flutter-expert`, `golang-pro`,
`graphql-architect`, `javascript-pro`, `legacy-modernizer`, `nestjs-expert`, `php-pro`,
`prompt-engineer`, `python-pro`, `sql-pro`, `typescript-pro`). Both copies are kept here since
they're different content from different authors, but only one can occupy
`~/.claude/skills/<name>/` at a time. `install.sh` / `Install.ps1` deploy
`antigravity-awesome-skills` first (it was vendored first) and skip a jeffallan skill of the same
name if that slot is already filled — first-vendored-wins, not a quality judgment.

## Why this is vendored

Same reasoning as the other two vendored libraries: explicitly requested by the user, full content
not just a catalog reference.

## Keeping this in sync

```bash
git clone --depth 1 https://github.com/jeffallan/claude-skills.git /tmp/jeffallan-src
rsync -a --delete /tmp/jeffallan-src/skills/ skills-library/jeffallan-claude-skills/skills/
cp /tmp/jeffallan-src/LICENSE /tmp/jeffallan-src/README.md skills-library/jeffallan-claude-skills/
```

Update the commit hash/date above after refreshing.
