#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch. Uses a throwaway git repo
# inside dist/ so we never have to track the build in the main history.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=$(git remote get-url origin)
NAME=$(git config user.name || echo "deploy")
EMAIL=$(git config user.email || echo "deploy@local")

npm run build

cd dist
touch .nojekyll          # serve folders verbatim; don't run Jekyll
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "deploy $(date -u +%FT%TZ)"
git push -f "$REPO" gh-pages
rm -rf .git
echo "Deployed to gh-pages -> https://wass08.github.io/fable-lite/"
