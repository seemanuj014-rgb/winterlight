#!/usr/bin/env bash
# Winterlight gate release: merge dev into main (production), tag, push. Run at gates G0-G3 only.
# Usage: bash scripts/release.sh 0.2.0
set -euo pipefail
[ -d .git ] || { echo "Run this from the repo root (the folder with .git)."; exit 1; }
v="${1:?Give the version, e.g. 0.2.0}"
pkg="$(node -p "require('./package.json').version")"
[ "$pkg" = "$v" ] || { echo "package.json says $pkg, expected $v. Extract the changed-files zip first."; exit 1; }
git checkout main
git merge dev --no-edit
git push origin main
git tag "v$v"
git push origin "v$v"
git checkout dev
echo "Released v$v. Vercel is updating production. Check the Deployments tab."
