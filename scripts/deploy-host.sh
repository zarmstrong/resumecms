#!/usr/bin/env bash
# Deploys this host's live sites: rebuilds and restarts their containers
# from the /opt/resumecms checkout (the build context in
# /opt/docker/personal-sites.yml). It's a deploy step, not a build step:
# for the local checks, run scripts/check.sh instead.
#
# It runs only as /opt/resumecms/scripts/deploy-host.sh, refuses unless
# that checkout is a clean `main` at exactly origin's main, asks before
# rebuilding unless given --yes, and then waits for each site to answer.
set -euo pipefail

CHECKOUT=/opt/resumecms
COMPOSE_DIR=/opt/docker
SERVICES=(resumecmsedbalseiro resumecmszacharyarmstrong)
READY_SECONDS=90

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

It runs only as $CHECKOUT/scripts/deploy-host.sh. To try an edited copy
from a worktree, point its checks at a scratch repo:
RESUMECMS_DEPLOY_CHECKOUT=<repo> scripts/deploy-host.sh --dry-run
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

# Only the copy on /opt/resumecms's main runs, never a branch's edited
# one; the test override runs from anywhere, and only as a dry run.
script_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
checkout_real=$(realpath -e "$CHECKOUT" 2>/dev/null || echo "$CHECKOUT")
if [[ "$CHECK_DIR" == "$CHECKOUT" && "$script_root" != "$checkout_real" ]]; then
  die "run $CHECKOUT/scripts/deploy-host.sh, not this copy in $script_root"
fi

# One deploy at a time.
# Locked on the checkout's directory, opened read-only: it creates no file,
# and unlike this script (which a pull replaces with a new file, and so a
# new lock) it stays the same directory.
exec 9<"$CHECK_DIR"
flock -n 9 || die "another deploy-host.sh is running"

# The checkout must be exactly origin's main: on main; nothing modified,
# staged, untracked, or ignored under what the Dockerfile copies (server/,
# client/, templates/; .dockerignore drops node_modules and dist), since
# that would go into the image; and HEAD the commit origin's main is now.
# It's compared with `git ls-remote`, which writes nothing to the checkout.
# Every failed check is listed.
git -C "$CHECK_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || die "$CHECK_DIR is not a git checkout"
check_checkout() {
  local problems=() branch head remote remote_ok=true extra
  # Asked first: it can take up to a minute, and the local checks below
  # have to describe the checkout as it is once it's answered.
  # Never wait on a credential prompt or a stalled remote.
  remote=$(GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -o BatchMode=yes" timeout 60 git -C "$CHECK_DIR" ls-remote --exit-code origin refs/heads/main) || remote_ok=false
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
  if [[ -n "$(git -C "$CHECK_DIR" ls-files --others --exclude-standard)" ]]; then
    problems+=("it has untracked files (git -C $CHECK_DIR status)")
  fi
  # (Filtered with grep: git 2.43's exclude pathspecs misfire on the nested
  # worktrees under .claude/.)
  extra=$(git -C "$CHECK_DIR" ls-files --others --ignored --exclude-standard -- server client templates \
    | grep -Ev '(^|/)(node_modules|dist)/' || true)
  if [[ -n "$extra" ]]; then
    problems+=("it has ignored files the image would copy: $(echo "$extra" | head -3 | tr '\n' ' ')")
  fi
  head=$(git -C "$CHECK_DIR" rev-parse HEAD)
  if ! $remote_ok; then
    problems+=("git ls-remote origin failed or timed out, so it can't be checked against origin's main")
  elif [[ "${remote%%[[:space:]]*}" != "$head" ]]; then
    problems+=("it is at ${head:0:7}, not origin's main ${remote:0:7} (git -C $CHECK_DIR pull --ff-only, or push)")
  fi
  if ((${#problems[@]})); then
    echo "deploy-host: refusing to deploy from $CHECK_DIR:" >&2
    printf '  - %s\n' "${problems[@]}" >&2
    exit 1
  fi
}
check_checkout
checked_head=$(git -C "$CHECK_DIR" rev-parse HEAD)

command=(docker compose up -d --build "${chosen[@]}")
echo "This rebuilds and restarts the live service(s): ${chosen[*]}"
head=$(git -C "$CHECK_DIR" log -1 --format='%h %s')
if [[ "$CHECK_DIR" == "$CHECKOUT" ]]; then
  echo "Built from: $CHECKOUT at $head"
else
  echo "Built from: $CHECKOUT"
  echo "Checked instead: $CHECK_DIR at $head (RESUMECMS_DEPLOY_CHECKOUT)"
fi
echo "Command: (cd $COMPOSE_DIR && ${command[*]})"

if ! $yes; then
  [[ -t 0 ]] || die "no terminal to confirm on; rerun with --yes to deploy without asking"
  read -r -p "Deploy to production? [y/N] " answer || answer=""
  case "$answer" in
    y | Y | yes | YES | Yes) ;;
    *) die "not deployed" ;;
  esac
fi

# The checkout may have changed since (the question can wait a long
# time): check again right before building, against the commit shown.
check_checkout
[[ "$(git -C "$CHECK_DIR" rev-parse HEAD)" == "$checked_head" ]] \
  || die "$CHECK_DIR moved to another commit meanwhile; not deployed"

if $dry_run; then
  echo "Dry run: not running it."
  exit 0
fi

cd "$COMPOSE_DIR"
"${command[@]}"

# `up -d` returns once the containers are replaced, not once the app in
# them has started; a server that refuses to boot (a missing session
# secret, a bad captcha setting) restarts in a loop. Wait for each site to
# answer before calling it deployed.
# One deadline for all of them, from here. The port is asked of compose
# (personal-sites.yml sets it from .env), never assumed.
deadline=$((SECONDS + READY_SECONDS))
waiting=("${chosen[@]}")
failed=()
while ((${#waiting[@]})); do
  still=()
  for service in "${waiting[@]}"; do
    # Bounded, so a stalled Docker daemon can't hold the lock forever.
    address=$(timeout 10 docker compose port "$service" 4000 2>/dev/null | tail -1 || true)
    port=${address##*:}
    if [[ -z "$port" ]] || ! curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$port/api/auth/status"; then
      still+=("$service")
    fi
  done
  waiting=("${still[@]}")
  ((${#waiting[@]})) || break
  if ((SECONDS >= deadline)); then
    failed=("${waiting[@]}")
    break
  fi
  sleep 3
done
if ((${#failed[@]})); then
  echo "deploy-host: not answering after ${READY_SECONDS}s: ${failed[*]}" >&2
  for service in "${failed[@]}"; do
    echo "--- last log lines of $service:" >&2
    timeout 20 docker compose logs --tail 20 "$service" >&2 || true
  done
  exit 1
fi
echo "Deployed: ${chosen[*]} (each answering on its port)."
