---
name: animateicons
description: Animated SVG icons for React via @animateicons/react -- 1000+ icons (Lucide, Hugeicons) animating on hover or an imperative trigger. Use when a UI wants an animated or micro-interaction icon.
---

> **PulsarIDE bundle note** -- vendored from `Avijit07x/animateicons` (MIT, see `ATTRIBUTION.md`).
> This is the skill's guidance plus the icon-name catalogue (`data/`); the icons themselves are the
> npm package `@animateicons/react`, which the user installs. The upstream website, MCP server and
> Next.js app are not bundled. It sends nothing anywhere -- plain React components.

# AnimateIcons

Animated SVG icons for React: hover and imperative triggers, `size` / `color` / `duration` props,
`motion` bundled. Reach for it when a button, toast, nav item or empty state wants a small piece of
motion instead of a dead icon -- not for decorative full-screen 3D (that is ThreeUI via `ui_find`).

## Install (the user's call -- offer it, do not assume)

```bash
pnpm add @animateicons/react   # or npm i / yarn add
```

`motion` comes with it. To carry no dependency, one icon's source can be copied with
`npx animateicons add <icon>` instead -- but prefer the package.

## Use

Import from the set (`/lucide` or `/huge`), PascalCase name + `Icon`; it animates on hover by default:

```tsx
import { BellRingIcon } from "@animateicons/react/lucide";

<BellRingIcon size={24} color="#f45b48" />
```

To animate from your own code, keep a ref to the icon's handle and call its `startAnimation()` /
`stopAnimation()`. The `size`, `color`, `duration` and trigger props are typed on each component.

## What is available (offline catalogue)

Both sets ship their names in `data/`, so you pick without the website:
- **Lucide** (669 icons) -- `data/lucide-icons.json`, imported from `@animateicons/react/lucide`.
  The everyday set: arrows, files, media, toggles, status.
- **Hugeicons** (352 icons) -- `data/huge-icons.json`, imported from `@animateicons/react/huge`.
  A broader, more illustrative set.

Read the matching JSON for exact names before importing; a name not in it will not resolve. The
interactive gallery and full API live on the upstream site, not in this bundle.

## Sample names

Lucide: menu, layout-dashboard, layers, layout-grid, blocks, layout-list, bring-to-front, accessibility, check, check-check, eye, eye-closed, eye-off, qr-code, scan-qr-code, scan, scan-line, user, user-round, shield-user
Hugeicons: menu-0-1, menu-0-2, dashboard-0-1, dashboard-0-2, dashboard-0-3, eye, bookmark, bookmark-check, bookmark-minus, bookmark-remove, loading-0-1, loading-0-2, copy, download, heart, search, check, check-check, notification, notification-off
