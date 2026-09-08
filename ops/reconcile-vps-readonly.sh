#!/usr/bin/env bash
# Read-only reconciliation helper for /opt/vitrinecity.
# It does not fetch, reset, checkout, pull, clean, copy, restart or inspect secrets.
set -euo pipefail

repo_dir="${1:-/opt/vitrinecity}"

redact_path() {
  case "$1" in
    .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|*secret*|*credential*|*.db|*.db-*|*.sqlite|*.sqlite3|*.sqlite-*|data/*|*/data/*)
      printf '%s\n' '[redacted-sensitive-path]'
      ;;
    *) printf '%s\n' "$1" ;;
  esac
}

print_paths() {
  local label="$1"
  shift
  printf '\n## %s\n' "$label"
  if (($# == 0)); then
    printf '%s\n' '(none)'
    return
  fi
  local item
  for item in "$@"; do redact_path "$item"; done | sort -u
}

if [[ ! -d "$repo_dir" ]]; then
  echo "ERROR: repository directory not found: $repo_dir" >&2
  exit 2
fi
cd "$repo_dir"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not a Git work tree: $repo_dir" >&2
  exit 3
fi

printf '# VitrineCity VPS reconciliation snapshot (read-only)\n'
printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'repo=%s\n' "$repo_dir"
printf 'branch=%s\n' "$(git branch --show-current 2>/dev/null || true)"
printf 'head=%s\n' "$(git rev-parse HEAD)"
printf 'head_short=%s\n' "$(git rev-parse --short=12 HEAD)"
printf 'describe=%s\n' "$(git describe --always --dirty --broken 2>/dev/null || true)"

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
printf 'upstream=%s\n' "${upstream:-none}"
if [[ -n "$upstream" ]]; then
  read -r behind ahead < <(git rev-list --left-right --count "$upstream...HEAD")
  printf 'behind_upstream=%s\n' "$behind"
  printf 'ahead_upstream=%s\n' "$ahead"
fi

if git show-ref --verify --quiet refs/remotes/origin/main; then
  read -r behind_main ahead_main < <(git rev-list --left-right --count origin/main...HEAD)
  printf 'origin_main=%s\n' "$(git rev-parse origin/main)"
  printf 'behind_origin_main=%s\n' "$behind_main"
  printf 'ahead_origin_main=%s\n' "$ahead_main"
else
  printf 'origin_main=unavailable_without_fetch\n'
fi

mapfile -t tracked_changed < <(git diff --name-only --diff-filter=ACDMRTUXB HEAD -- 2>/dev/null || true)
mapfile -t staged_changed < <(git diff --cached --name-only --diff-filter=ACDMRTUXB -- 2>/dev/null || true)
mapfile -t untracked < <(git ls-files --others --exclude-standard 2>/dev/null || true)

print_paths 'Tracked working-tree changes (names only)' "${tracked_changed[@]}"
print_paths 'Staged changes (names only)' "${staged_changed[@]}"
print_paths 'Untracked files (names only, sensitive paths redacted)' "${untracked[@]}"

printf '\n## Counts\n'
printf 'tracked_changed=%s\n' "${#tracked_changed[@]}"
printf 'staged_changed=%s\n' "${#staged_changed[@]}"
printf 'untracked=%s\n' "${#untracked[@]}"

printf '\n## Key project files\n'
for file in docker-compose.yml Caddyfile app/server.js ops/verify-release.sh; do
  if [[ -f "$file" ]]; then
    printf '%s sha256=%s\n' "$file" "$(sha256sum "$file" | awk '{print $1}')"
  else
    printf '%s MISSING\n' "$file"
  fi
done

printf '\n## Docker Compose state (read-only)\n'
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose ps 2>/dev/null || printf '%s\n' 'docker compose ps unavailable'
  printf '\n### Images\n'
  docker compose images 2>/dev/null || printf '%s\n' 'docker compose images unavailable'
else
  printf '%s\n' 'Docker Compose unavailable'
fi

printf '\n## Local health probes (read-only)\n'
if command -v curl >/dev/null 2>&1; then
  for url in http://127.0.0.1:3000/api/health http://127.0.0.1:3000/api/spatial/v1; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 4 "$url" 2>/dev/null || true)"
    printf '%s -> %s\n' "$url" "${code:-unreachable}"
  done
else
  printf '%s\n' 'curl unavailable'
fi

printf '\n## Safety confirmation\n'
printf '%s\n' 'No fetch, pull, reset, checkout, clean, file content dump, database read, secret read, container restart or deploy action was performed.'
