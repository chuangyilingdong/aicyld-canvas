#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: prune-production-backups.sh [options]

Prunes expired AICYLD Canvas production rollback artifacts. The default mode is
read-only; pass --apply to delete.

Options:
  --backup-root PATH     Backup directory (default: /srv/aicyld/canvas/backups)
  --web-root PATH        Canvas deployment root (default: parent of backup root)
  --keep-backends N      Keep newest backend binaries (default: 7)
  --keep-databases N     Keep newest database snapshots (default: 7)
  --keep-web-tarballs N  Keep newest frontend tarballs (default: 5)
  --keep-web-dirs N      Keep newest frontend directories (default: 3)
  --keep PATH            Always keep PATH; may be repeated
  --apply                Delete candidates; otherwise only print the plan
  -h, --help             Show this help

Only direct children of the backup/web roots are considered. Active web-dist,
new staging directories, configuration files, plugins, and unrecognized files
are never matched.
EOF
}

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

require_uint() {
    [[ "${1:-}" =~ ^[0-9]+$ ]] || die "$2 must be a non-negative integer"
}

human_bytes() {
    awk -v bytes="$1" 'BEGIN {
        split("B KiB MiB GiB TiB", units, " ")
        value = bytes
        unit = 1
        while (value >= 1024 && unit < 5) {
            value /= 1024
            unit++
        }
        printf "%.1f %s", value, units[unit]
    }'
}

mode="dry-run"
backup_root="${BACKUP_ROOT:-/srv/aicyld/canvas/backups}"
web_root="${WEB_ROOT:-}"
keep_backends=7
keep_databases=7
keep_web_tarballs=5
keep_web_dirs=3
declare -a keep_paths=()

while (($#)); do
    case "$1" in
        --backup-root)
            [[ $# -ge 2 ]] || die "--backup-root requires a value"
            backup_root="$2"
            shift 2
            ;;
        --web-root)
            [[ $# -ge 2 ]] || die "--web-root requires a value"
            web_root="$2"
            shift 2
            ;;
        --keep-backends)
            [[ $# -ge 2 ]] || die "--keep-backends requires a value"
            keep_backends="$2"
            shift 2
            ;;
        --keep-databases)
            [[ $# -ge 2 ]] || die "--keep-databases requires a value"
            keep_databases="$2"
            shift 2
            ;;
        --keep-web-tarballs)
            [[ $# -ge 2 ]] || die "--keep-web-tarballs requires a value"
            keep_web_tarballs="$2"
            shift 2
            ;;
        --keep-web-dirs)
            [[ $# -ge 2 ]] || die "--keep-web-dirs requires a value"
            keep_web_dirs="$2"
            shift 2
            ;;
        --keep)
            [[ $# -ge 2 ]] || die "--keep requires a value"
            keep_paths+=("$2")
            shift 2
            ;;
        --apply)
            mode="apply"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            die "unknown option: $1"
            ;;
    esac
done

require_uint "$keep_backends" "--keep-backends"
require_uint "$keep_databases" "--keep-databases"
require_uint "$keep_web_tarballs" "--keep-web-tarballs"
require_uint "$keep_web_dirs" "--keep-web-dirs"

[[ -d "$backup_root" ]] || die "backup root does not exist: $backup_root"
backup_root="$(realpath -e -- "$backup_root")"

if [[ -z "$web_root" ]]; then
    web_root="$(dirname "$backup_root")"
fi
[[ -d "$web_root" ]] || die "web root does not exist: $web_root"
web_root="$(realpath -e -- "$web_root")"

[[ "$backup_root" != "/" ]] || die "refusing to use / as the backup root"
[[ "$web_root" != "/" ]] || die "refusing to use / as the web root"
[[ "$backup_root" != "$web_root" ]] || die "backup and web roots must differ"
[[ "$backup_root" == "$web_root/"* ]] || die "backup root must be inside the web root"

declare -A protected=()
for path in "${keep_paths[@]}"; do
    [[ -e "$path" ]] || die "protected path does not exist: $path"
    protected["$(realpath -e -- "$path")"]=1
done

kept_count=0
deleted_count=0
freed_bytes=0

is_protected() {
    local resolved
    resolved="$(realpath -e -- "$1")"
    [[ -n "${protected[$resolved]:-}" ]]
}

delete_candidate() {
    local root="$1"
    local path="$2"
    local resolved root_resolved parent bytes

    resolved="$(realpath -e -- "$path")"
    root_resolved="$(realpath -e -- "$root")"
    parent="$(dirname "$resolved")"
    [[ "$parent" == "$root_resolved" ]] || die "refusing non-direct child: $resolved"
    [[ -d "$resolved" || -f "$resolved" ]] || die "unsupported candidate type: $resolved"

    bytes="$(du -sb -- "$resolved" | cut -f1)"
    if [[ "$mode" == "apply" ]]; then
        if [[ -d "$resolved" && ! -L "$resolved" ]]; then
            rm -rf -- "$resolved"
        else
            rm -f -- "$resolved"
        fi
        printf 'DELETE  %s\n' "$resolved"
    else
        printf 'WOULD DELETE  %s\n' "$resolved"
    fi
    deleted_count=$((deleted_count + 1))
    freed_bytes=$((freed_bytes + bytes))
}

prune_entries() {
    local label="$1"
    local root="$2"
    local kind="$3"
    local keep_count="$4"
    local pattern="$5"
    local -a entries=()
    local index=0
    local path

    if [[ "$kind" == "file" ]]; then
        mapfile -t entries < <(
            find "$root" -mindepth 1 -maxdepth 1 -type f -name "$pattern" \
                -printf '%T@\t%p\n' | sort -t $'\t' -k1,1nr | cut -f2-
        )
    else
        mapfile -t entries < <(
            find "$root" -mindepth 1 -maxdepth 1 -type d -name "$pattern" \
                -printf '%T@\t%p\n' | sort -t $'\t' -k1,1nr | cut -f2-
        )
    fi

    printf '\n[%s] %d matched\n' "$label" "${#entries[@]}"
    for path in "${entries[@]}"; do
        if ((index < keep_count)) || is_protected "$path"; then
            printf 'KEEP    %s\n' "$path"
            kept_count=$((kept_count + 1))
        else
            delete_candidate "$root" "$path"
        fi
        index=$((index + 1))
    done
}

printf 'AICYLD Canvas backup retention (%s)\n' "$mode"
printf 'backup root: %s\n' "$backup_root"
printf 'web root:    %s\n' "$web_root"

prune_entries "backend binaries" "$backup_root" file "$keep_backends" 'infinite-canvas-backend*'
prune_entries "database snapshots" "$backup_root" file "$keep_databases" 'open_ai_canvas.db.*'
prune_entries "frontend tarballs" "$backup_root" file "$keep_web_tarballs" 'web-dist*.tar.gz'
prune_entries "frontend backup directories" "$backup_root" dir "$keep_web_dirs" 'web-dist*'
prune_entries "root frontend rollbacks" "$web_root" dir "$keep_web_dirs" 'web-dist.prev*'

printf '\nSummary: kept=%d delete=%d reclaim=%s\n' \
    "$kept_count" "$deleted_count" "$(human_bytes "$freed_bytes")"
if [[ "$mode" == "dry-run" ]]; then
    printf 'Dry run only. Re-run with --apply to delete the listed paths.\n'
fi
