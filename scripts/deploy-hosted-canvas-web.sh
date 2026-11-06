#!/usr/bin/env bash
set -euo pipefail

# Hosted canvas frontend deployment with zero-downtime asset retention.
# Usage: deploy-hosted-canvas-web.sh <tarball> <version> <commit> <sha256>
#
# The script keeps hashed files from recently served releases available under
# /static so tabs that were open during a deploy can still lazy-load chunks.
# It also verifies that index.html and version.json are not cacheable.

TARBALL="${1:?tarball is required}"
VERSION="${2:?version is required}"
COMMIT="${3:?commit is required}"
EXPECTED_SHA256="${4:?sha256 is required}"
ROOT="${CANVAS_ROOT:-/srv/aicyld/canvas}"
PUBLIC_URL="${CANVAS_PUBLIC_URL:-https://hb.aicyld.com.cn}"
RETENTION_DAYS="${CANVAS_ASSET_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

test -f "$TARBALL"
test -f "$ROOT/web-dist/index.html"
ACTUAL_SHA256="$(sha256sum "$TARBALL" | awk '{print $1}')"
test "$ACTUAL_SHA256" = "$EXPECTED_SHA256"

BACKUP="$ROOT/backups/web-dist.pre-${VERSION}-${STAMP}.tar.gz"
PREV="$ROOT/.web-dist.prev-${VERSION}-${STAMP}"
NEW="$ROOT/web-dist.new-${VERSION}-${STAMP}"
META_BACKUP="$ROOT/backups/release-meta.pre-${VERSION}-${STAMP}"
MANIFEST_DIR="$ROOT/asset-releases"
mkdir -p "$ROOT/backups" "$MANIFEST_DIR"

test ! -e "$BACKUP"
test ! -e "$PREV"
test ! -e "$NEW"
test ! -e "$META_BACKUP"

tar -czf "$BACKUP" -C "$ROOT/web-dist" .
mkdir -p "$NEW"
tar -C "$NEW" -xzf "$TARBALL"
test -f "$NEW/index.html"
test -f "$NEW/version.json"

python3 - "$NEW/version.json" "$VERSION" "$COMMIT" <<'PY'
import json, sys
path, version, commit = sys.argv[1:]
with open(path, encoding='utf-8') as file:
    manifest = json.load(file)
if not manifest.get('buildId') or not manifest.get('files'):
    raise SystemExit('version.json is missing buildId/files')
if manifest.get('version') != version:
    raise SystemExit(f"version.json version mismatch: {manifest.get('version')} != {version}")
if manifest.get('commit') != commit:
    raise SystemExit(f"version.json commit mismatch: {manifest.get('commit')} != {commit}")
PY

# Never overwrite a newly built hashed file, but keep every old hashed path
# available to tabs that loaded the previous index.html.
if [ -d "$ROOT/web-dist/static" ]; then
    mkdir -p "$NEW/static"
    cp -an "$ROOT/web-dist/static/." "$NEW/static/"
fi

ENTRY="$(grep -oE '/static/index-[^"]+\.js' "$NEW/index.html" | head -n1)"
OLD_ENTRY="$(grep -oE '/static/index-[^"]+\.js' "$ROOT/web-dist/index.html" | head -n1 || true)"
test -n "$ENTRY"
test -f "$NEW$ENTRY"
if [ -n "$OLD_ENTRY" ]; then
    test -f "$NEW$OLD_ENTRY"
fi

chown -R www-data:www-data "$NEW"
find "$NEW" -type d -exec chmod 755 {} +
find "$NEW" -type f -exec chmod 644 {} +

mkdir -p "$META_BACKUP"
cp -a "$ROOT/VERSION" "$META_BACKUP/VERSION"
cp -a "$ROOT/RELEASE.json" "$META_BACKUP/RELEASE.json"

rollback() {
    if [ -d "$ROOT/web-dist" ] && [ -d "$PREV" ]; then
        mv "$ROOT/web-dist" "$ROOT/web-dist.failed-${VERSION}-${STAMP}"
        mv "$PREV" "$ROOT/web-dist"
        cp -a "$META_BACKUP/VERSION" "$ROOT/VERSION"
        cp -a "$META_BACKUP/RELEASE.json" "$ROOT/RELEASE.json"
        systemctl reload nginx
    fi
}

mv "$ROOT/web-dist" "$PREV"
mv "$NEW" "$ROOT/web-dist"
systemctl reload nginx

if ! curl -fsS --max-time 15 "$PUBLIC_URL/" | grep -Fq "$ENTRY" \
    || ! curl -fsS --max-time 15 "$PUBLIC_URL$ENTRY" -o /dev/null \
    || ! curl -fsS --max-time 15 "$PUBLIC_URL$OLD_ENTRY" -o /dev/null; then
    echo "external frontend or retained asset verification failed; rolling back" >&2
    trap - ERR
    rollback
    exit 1
fi

INDEX_HEADERS="$(curl -fsSI --max-time 15 "$PUBLIC_URL/")"
VERSION_HEADERS="$(curl -fsSI --max-time 15 "$PUBLIC_URL/version.json")"
if ! grep -Eiq '^cache-control:.*no-store' <<<"$INDEX_HEADERS"; then
    echo "index.html must return Cache-Control: no-store" >&2
    rollback
    exit 1
fi
if ! grep -Eiq '^cache-control:.*no-store' <<<"$VERSION_HEADERS"; then
    echo "version.json must return Cache-Control: no-store" >&2
    rollback
    exit 1
fi

cp "$ROOT/web-dist/version.json" "$MANIFEST_DIR/${VERSION}-${STAMP}.json"

if ! python3 - "$ROOT" "$VERSION" "$COMMIT" <<'PY'
import json, sys
from datetime import datetime, timezone
root, version, commit = sys.argv[1:]
path = f'{root}/RELEASE.json'
with open(path, encoding='utf-8') as file:
    release = json.load(file)
now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
release.update({
    'version': version,
    'commit': commit,
    'buildTime': now,
    'frontendCommit': commit,
    'frontendBuildTime': now,
})
entry = None
with open(f'{root}/web-dist/index.html', encoding='utf-8') as file:
    import re
    match = re.search(r'/static/index-[^"\']+\.js', file.read())
    if match:
        entry = match.group(0)
if not entry:
    raise SystemExit('frontend entry not found')
release['frontendEntry'] = entry
with open(path, 'w', encoding='utf-8') as file:
    json.dump(release, file, ensure_ascii=False, indent=2)
    file.write('\n')
with open(f'{root}/VERSION', 'w', encoding='utf-8') as file:
    file.write(version + '\n')
PY
then
    echo "release metadata update failed; rolling back" >&2
    rollback
    exit 1
fi

python3 - "$ROOT" "$RETENTION_DAYS" <<'PY'
import json, os, time
from pathlib import Path
root = Path(sys.argv[1])
retention_days = int(sys.argv[2])
cutoff = time.time() - retention_days * 86400
manifest_dir = root / 'asset-releases'
keep = set()
for path in manifest_dir.glob('*.json'):
    if path.stat().st_mtime < cutoff:
        path.unlink(missing_ok=True)
        continue
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        keep.update(item for item in data.get('files', []) if isinstance(item, str))
    except Exception:
        # A malformed old manifest must not make deployment delete live assets.
        keep.update(
            str(file.relative_to(root / 'web-dist')).replace(os.sep, '/')
            for file in (root / 'web-dist' / 'static').rglob('*') if file.is_file()
        )
current = root / 'web-dist' / 'version.json'
if current.exists():
    try:
        keep.update(json.loads(current.read_text(encoding='utf-8')).get('files', []))
    except Exception:
        pass
for file in (root / 'web-dist' / 'static').rglob('*'):
    if not file.is_file() or file.stat().st_mtime >= cutoff:
        continue
    relative = str(file.relative_to(root / 'web-dist')).replace(os.sep, '/')
    if relative not in keep:
        file.unlink(missing_ok=True)
PY

echo "frontend=$VERSION"
echo "entry=$ENTRY"
echo "old_entry=$OLD_ENTRY"
echo "backup=$BACKUP"
echo "previous=$PREV"
echo "meta_backup=$META_BACKUP"
