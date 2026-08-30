# ThreeUI Community (vendored, source only)

- **Upstream:** https://github.com/MengTo/threeui
- **Vendored commit:** `326580429881c2abe7893bee53c62cbb31b6ee49`
- **Vendored on:** 2026-08-30
- **License:** MIT (see `LICENSE`, © 2026 Meng To)
- **Package:** `@designcodeio/threeui` — depends on `three`

## What is here

The Community edition's shader/3D UI component source: 44 components, 82 files
(`.tsx` / `.ts` / `.css` / `.svg`), copied from upstream `src/shaders/` with its
directory layout intact. `INDEX.md` lists every component and its entry file.

Each component is a self-contained React component that builds its own
`THREE.WebGLRenderer` and cleans up after itself, so one can be copied into a
project and used on its own.

## What was left out, and why

Upstream is a 141 MB Vite application; almost none of it is the components.
Excluded: `public/` (78 MB of demo media), the app shell (routing, SEO, search),
and — inside `src/shaders/` — the `.html` demo dumps (one is 2.3 MB), the
bundled `three.min.js` copies, and the `.webp` / `.woff2` demo assets. That takes
8.4 MB down to 0.9 MB with no loss of reusable source.

Consequence to know about: a handful of components reference demo assets that
were not vendored (`./assets/*.webp`). Substitute your own — the shader code,
which is the part worth having, is complete.

## Two upstream routes deliberately NOT wired in

- **The ThreeUI MCP server** is a remote endpoint (`https://threeui.com/api/mcp`),
  not something that can be vendored. It is not registered automatically: it is
  an external network service that would receive prompts, which is the user's
  call to make, not an installer's.
- **`@designcodeio/threeui-cli`** (`npx @designcodeio/threeui-cli add <name>`)
  downloads *Pro* component source and requires a browser OAuth sign-in with a
  paid account. It cannot be pre-installed, and the free components are already
  here.

Both are documented for the Council so an agent can offer them when a user
actually wants Pro components or the live catalog.
