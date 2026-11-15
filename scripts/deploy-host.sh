#!/usr/bin/env bash
# Deploys this host's live sites: rebuilds and restarts their containers
# from the /opt/resumecms checkout (the build context in
# /opt/docker/personal-sites.yml), whichever checkout or worktree this
# script is run from. It's a deploy step, not a build step: for the local
# checks, run scripts/check.sh instead.
#
# It refuses unless /opt/resumecms is on a clean `main` that isn't behind
# origin/main, and asks before rebuilding unless given --yes.
set -euo pipefail

CHECKOUT=/opt/resumecms
COMPOSE_DIR=/opt/docker
SERVICES=(resumecmsedbalseiro resumecmszacharyarmstrong)

# Tests point the checks at a scratch repo. The build context stays
# /opt/resumecms whatever this says, so it's only honored with --dry-run.
CHECK_DIR="${RESUMECMS_DEPLOY_CHECKOUT:-$CHECKOUT}"

usage() {
  cat <<EOF
Usage: scripts/deploy-host.sh [--yes] [--dry-run] [service ...]

Rebuilds and restarts the live services from $CHECKOUT with
\`docker compose up -d --build\` in $COMPOSE_DIR. This replaces production.

  service    rebuild only these (default: all of ${SERVICES[*]})
  --yes, -y  don't ask for confirmation (needed without a terminal)
  --dry-run  run every check and the confirmation, then print the
             command instead of running it
  --help     show this help
EOF
}

die() {
  echo "deploy-host: $*" >&2
  exit 1
}

usage_error() {
  echo "deploy-host: $*" >&2
  echo "Run with --help for usage." >&2
  exit 2
}

yes=false
dry_run=false
chosen=()
while (($#)); do
  case "$1" in
    -y | --yes) yes=true ;;
    --dry-run) dry_run=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      chosen+=("$@")
      break
      ;;
    -*) usage_error "unknown option: $1" ;;
    *) chosen+=("$1") ;;
  esac
  shift
done

if ((${#chosen[@]} == 0)); then
  chosen=("${SERVICES[@]}")
fi
for name in "${chosen[@]}"; do
  known=false
  for service in "${SERVICES[@]}"; do
    if [[ "$name" == "$service" ]]; then known=true; fi
  done
  $known || usage_error "unknown service: $name (known: ${SERVICES[*]})"
done

if [[ "$CHECK_DIR" != "$CHECKOUT" ]] && ! $dry_run; then
  die "RESUMECMS_DEPLOY_CHECKOUT is for testing and needs --dry-run: the build always uses $CHECKOUT"
fi

# The checkout must be what's on origin/main: on main, nothing modified or
# staged, and nothing on origin/main it lacks. Every failed check is listed.
git -C "$CHECK_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || die "$CHECK_DIR is not a git checkout"
problems=()
branch=$(git -C "$CHECK_DIR" symbolic-ref --short -q HEAD || true)
if [[ "$branch" != main ]]; then
  problems+=("it is on ${branch:-a detached HEAD}, not main")
fi
if ! git -C "$CHECK_DIR" diff --quiet; then
  problems+=("it has modified tracked files (git -C $CHECK_DIR status)")
fi
if ! git -C "$CHECK_DIR" diff --cached --quiet; then
  problems+=("it has staged changes (git -C $CHECK_DIR status)")
fi
if ! git -C "$CHECK_DIR" fetch --quiet origin; then
  problems+=("git fetch origin failed, so it can't be checked against origin/main")
elif ! behind=$(git -C "$CHECK_DIR" rev-list --count HEAD..origin/main 2>/dev/null); then
  problems+=("it has no origin/main to compare with")
elif ((behind > 0)); then
  problems+=("it is $behind commit(s) behind origin/main (git -C $CHECK_DIR pull --ff-only)")
fi
if ((${#problems[@]})); then
  echo "deploy-host: refusing to deploy from $CHECK_DIR:" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi

here=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || true)
command=(docker compose up -d --build "${chosen[@]}")
echo "This rebuilds and restarts the live service(s): ${chosen[*]}"
head=$(git -C "$CHECK_DIR" log -1 --format='%h %s')
if [[ "$CHECK_DIR" == "$CHECKOUT" ]]; then
  echo "Built from: $CHECKOUT at $head"
else
  echo "Built from: $CHECKOUT"
  echo "Checked instead: $CHECK_DIR at $head (RESUMECMS_DEPLOY_CHECKOUT)"
fi
if [[ -n "$here" && "$here" != "$CHECKOUT" ]]; then
  echo "Note: this script is running from $here; that checkout is not what gets built."
fi
echo "Command: (cd $COMPOSE_DIR && ${command[*]})"

if ! $yes; then
  [[ -t 0 ]] || die "no terminal to confirm on; rerun with --yes to deploy without asking"
  read -r -p "Deploy to production? [y/N] " answer
  case "$answer" in
    y | Y | yes | YES | Yes) ;;
    *) die "not deployed" ;;
  esac
fi

if $dry_run; then
  echo "Dry run: not running it."
  exit 0
fi

cd "$COMPOSE_DIR"
"${command[@]}"
