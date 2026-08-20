#!/usr/bin/env bash
# Install what the design harness needs (once). Everything lands in
# ide/design/.work, which is gitignored.
#
#   ./ide/design/setup.sh
#   node ide/design/render.mjs        # screenshots of the real surfaces
#   node ide/design/make-icons.mjs    # regenerate the app icons from assets/icon.svg
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HERE/.work"
cd "$HERE/.work"
[ -f package.json ] || printf '{"name":"planide-design-harness","private":true}\n' > package.json
npm i --silent --no-audit --no-fund \
  react@19 react-dom@19 @types/react @types/react-dom @types/node \
  clsx tailwind-merge class-variance-authority radix-ui lucide-react \
  esbuild typescript tailwindcss@4
echo "design harness ready -> $HERE/.work"
