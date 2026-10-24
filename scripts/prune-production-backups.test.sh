#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prune="$script_dir/prune-production-backups.sh"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT

backup_root="$fixture/canvas/backups"
web_root="$fixture/canvas"
mkdir -p "$backup_root" "$web_root/web-dist" "$web_root/web-dist.new-current"
printf 'active frontend\n' >"$web_root/web-dist/index.html"
printf 'staging frontend\n' >"$web_root/web-dist.new-current/index.html"

make_file() {
    local path="$1"
    local day="$2"
    printf 'fixture\n' >"$path"
    touch -d "2026-10-${day} 00:00:00 +0000" "$path"
}

make_dir() {
    local path="$1"
    local day="$2"
    mkdir -p "$path"
    printf 'fixture\n' >"$path/index.html"
    touch -d "2026-10-${day} 00:00:00 +0000" "$path"
}

for day in 01 02 03 04 05 06 07 08 09; do
    make_file "$backup_root/infinite-canvas-backend.$day" "$day"
    make_file "$backup_root/open_ai_canvas.db.$day" "$day"
done

for day in 01 02 03 04 05 06 07; do
    make_file "$backup_root/web-dist.$day.tar.gz" "$day"
done

for day in 01 02 03 04 05; do
    make_dir "$backup_root/web-dist.$day" "$day"
    make_dir "$web_root/web-dist.prev-$day" "$day"
done

"$prune" \
    --backup-root "$backup_root" \
    --web-root "$web_root" \
    --keep-backends 3 \
    --keep-databases 3 \
    --keep-web-tarballs 2 \
    --keep-web-dirs 2 \
    --keep "$backup_root/infinite-canvas-backend.01" \
    >"$fixture/dry-run.log"

grep -q 'Dry run only' "$fixture/dry-run.log"
test -f "$backup_root/infinite-canvas-backend.01"
test -f "$backup_root/infinite-canvas-backend.04"
test -f "$backup_root/open_ai_canvas.db.04"
test -f "$backup_root/web-dist.03.tar.gz"
test -d "$backup_root/web-dist.03"
test -d "$web_root/web-dist.prev-03"
test -f "$web_root/web-dist/index.html"
test -f "$web_root/web-dist.new-current/index.html"

"$prune" \
    --backup-root "$backup_root" \
    --web-root "$web_root" \
    --keep-backends 3 \
    --keep-databases 3 \
    --keep-web-tarballs 2 \
    --keep-web-dirs 2 \
    --keep "$backup_root/infinite-canvas-backend.01" \
    --apply \
    >"$fixture/apply.log"

for day in 01 07 08 09; do
    test -f "$backup_root/infinite-canvas-backend.$day"
done
for day in 02 03 04 05 06; do
    test ! -e "$backup_root/infinite-canvas-backend.$day"
done

for day in 07 08 09; do
    test -f "$backup_root/open_ai_canvas.db.$day"
done
for day in 01 02 03 04 05 06; do
    test ! -e "$backup_root/open_ai_canvas.db.$day"
done

for day in 06 07; do
    test -f "$backup_root/web-dist.$day.tar.gz"
done
for day in 01 02 03 04 05; do
    test ! -e "$backup_root/web-dist.$day.tar.gz"
done

for day in 04 05; do
    test -d "$backup_root/web-dist.$day"
    test -d "$web_root/web-dist.prev-$day"
done
for day in 01 02 03; do
    test ! -e "$backup_root/web-dist.$day"
    test ! -e "$web_root/web-dist.prev-$day"
done

test -f "$web_root/web-dist/index.html"
test -f "$web_root/web-dist.new-current/index.html"

printf 'prune-production-backups tests passed\n'
