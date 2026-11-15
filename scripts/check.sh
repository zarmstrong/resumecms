#!/usr/bin/env bash
# Runs the local checks for the worktree this script is in: the template
# validator, both packages' tests, lint and type checks, the client build
# and the browser suite, stopping at the first failure. It never touches Docker or a running service; to deploy,
# see scripts/deploy-host.sh.
#
# Needs `npm ci` in server/ and client/ first.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

# The client build writes client/dist, and production builds from
# /opt/resumecms, which is never worked in: run this from a worktree.
if [[ "$root" == "$(realpath -e /opt/resumecms 2>/dev/null || echo /opt/resumecms)" ]]; then
  echo "check: not in /opt/resumecms (production builds from it); run it from a worktree" >&2
  exit 1
fi

for pkg in server client; do
  [[ -d "$root/$pkg/node_modules" ]] \
    || { echo "check: $pkg/node_modules is missing; run npm ci in $root/$pkg first" >&2; exit 1; }
done

step() {
  echo
  echo "==> $*"
}

step "node scripts/validate-templates.mjs"
(cd "$root" && node scripts/validate-templates.mjs)

for pkg in server client; do
  for script in test lint typecheck; do
    step "npm run $script ($pkg/)"
    (cd "$root/$pkg" && npm run "$script")
  done
done

step "npm run build (client/)"
(cd "$root/client" && npm run build)

# The browser suite drives the build just made.
step "npm run test:browser (server/)"
(cd "$root/server" && npm run test:browser)

echo
echo "check: all passed ($root)"
