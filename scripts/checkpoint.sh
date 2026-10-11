#!/usr/bin/env bash
# Tag a working state (§19: every two hours during the hackathon).
#
#   scripts/checkpoint.sh            tags the current commit as checkpoint-YYYYMMDD-HHMM if the checks pass
#   scripts/checkpoint.sh "note"     adds a note to the tag message
#
# Only tags a clean, passing tree. It never commits, pushes or force-moves a tag.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has uncommitted changes. Commit first, then tag." >&2
  exit 1
fi

npm run check
npm run build

tag="checkpoint-$(date +%Y%m%d-%H%M)"
git tag -a "$tag" -m "${1:-Working state}"
echo "Tagged $tag. Push it with: git push origin $tag"
