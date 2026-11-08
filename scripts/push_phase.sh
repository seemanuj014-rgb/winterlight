#!/usr/bin/env bash
# Winterlight phase push. Run from the repo root AFTER extracting the changed-files zip over the repo folder.
# Usage: bash scripts/push_phase.sh "Phase 5: reference intake"
set -euo pipefail
[ -d .git ] || { echo "Run this from the repo root (the folder with .git)."; exit 1; }
msg="${1:?Give a commit message, e.g. \"Phase 5: reference intake\"}"
[ "$(git rev-parse --abbrev-ref HEAD)" = "dev" ] || git checkout dev
git add .
git commit -m "$msg"
git push origin dev
echo "Pushed to dev. Vercel is building a preview: open vercel.com, Deployments, newest one, then open it on your phone."
