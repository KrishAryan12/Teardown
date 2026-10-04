#!/usr/bin/env bash
# Assembles a flattened folder for the HuggingFace Space (Docker SDK). HF builds from the Space
# repo root, so the Dockerfile and the Space README (front matter: sdk: docker, app_port: 7860)
# go at the top, with the parts of the monorepo the scanner needs.
#
#   scripts/build-space.sh [out-dir]     (default: .space-build)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.space-build}"

rm -rf "$OUT"
mkdir -p "$OUT/apps/scanner" "$OUT/apps/web" "$OUT/packages"

cp "$ROOT/apps/scanner/Dockerfile" "$OUT/Dockerfile"
cp "$ROOT/apps/scanner/space/README.md" "$OUT/README.md"
cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$ROOT/tsconfig.base.json" "$OUT/"
cp "$ROOT/LICENSE" "$OUT/LICENSE"

# Core package (consumed as source and bundled into the scanner).
mkdir -p "$OUT/packages/core"
cp -r "$ROOT/packages/core/src" "$ROOT/packages/core/package.json" "$ROOT/packages/core/tsconfig.json" "$OUT/packages/core/"

# Scanner: sources, in-page scripts and build script only (no tests, fixtures or local builds).
for item in src inpage package.json tsconfig.json build.mjs; do
  cp -r "$ROOT/apps/scanner/$item" "$OUT/apps/scanner/"
done

# The web app's manifest only: the lockfile lists it as a workspace project.
cp "$ROOT/apps/web/package.json" "$OUT/apps/web/package.json"

cat > "$OUT/.dockerignore" <<'EOF'
**/node_modules
**/dist
.git
EOF

# Never ship secrets.
if grep -rIl --exclude-dir=node_modules -E '(sk-|gsk_|hf_|AIza)[A-Za-z0-9_-]{16,}' "$OUT" >/dev/null 2>&1; then
  echo "error: something that looks like an API key is in the Space build" >&2
  exit 1
fi

echo "Space folder ready: $OUT"
find "$OUT" -maxdepth 3 -not -path '*/src/*' | sed "s|$OUT|.|" | sort
