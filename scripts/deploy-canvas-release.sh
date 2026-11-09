#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy a complete Canvas release. The bundle is self-describing and checked
# both before and after extraction; a failed activation restores the previous
# frontend, backend, agent host, metadata and database snapshot.

usage() {
  cat >&2 <<'EOF'
Usage:
  deploy-canvas-release.sh <bundle.tar.gz> <expected-sha256> [options]

Options:
  --verify-only                 Validate the bundle without changing production.
  --wait-active-seconds N       Wait up to N seconds for active tasks (default: 300).
  --skip-db-backup              Skip the SQLite consistent snapshot.
  --health-timeout N            Backend startup timeout in seconds (default: 120).

Environment:
  CANVAS_ROOT                   Default: /srv/aicyld/canvas
  CANVAS_SERVICE                Default: aicyld-canvas
  CANVAS_PUBLIC_URL             Default: https://hb.aicyld.com.cn
  CANVAS_BACKEND_HEALTH_URL     Default: http://127.0.0.1:8080/api/health
  CANVAS_DB_PATH                Default: $CANVAS_ROOT/data/open_ai_canvas.db
EOF
  exit 2
}

[[ $# -ge 2 ]] || usage
bundle="$1"
expected_sha="$2"
shift 2

verify_only=0
wait_active=300
skip_db_backup=0
health_timeout=120
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verify-only) verify_only=1; shift ;;
    --wait-active-seconds) wait_active="${2:-}"; shift 2 ;;
    --skip-db-backup) skip_db_backup=1; shift ;;
    --health-timeout) health_timeout="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[[ -f "$bundle" ]] || { echo "bundle not found: $bundle" >&2; exit 2; }
[[ "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "expected SHA256 is invalid" >&2; exit 2; }
[[ "$wait_active" =~ ^[0-9]+$ && "$health_timeout" =~ ^[1-9][0-9]*$ ]] || { echo "timeout must be numeric" >&2; exit 2; }
python_bin="${PYTHON_BIN:-}"
if [[ -z "$python_bin" ]]; then
  if command -v python3 >/dev/null; then python_bin=python3
  elif command -v python >/dev/null; then python_bin=python
  else echo "python3 or python is required" >&2; exit 2
  fi
fi

root="${CANVAS_ROOT:-/srv/aicyld/canvas}"
service="${CANVAS_SERVICE:-aicyld-canvas}"
public_url="${CANVAS_PUBLIC_URL:-https://hb.aicyld.com.cn}"
health_url="${CANVAS_BACKEND_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
db_path="${CANVAS_DB_PATH:-$root/data/open_ai_canvas.db}"
stamp="$(date -u +%Y%m%d-%H%M%S)"

stage="$(mktemp -d "${TMPDIR:-/tmp}/canvas-deploy.XXXXXX")"
new_web=""
new_agent=""
new_backend=""
prev_web=""
backup=""
version=""
commit=""
entry=""
changes_started=0
backend_switched=0
agent_switched=0
web_switched=0
committed=0

wait_health() {
  local limit="${1:-$health_timeout}" elapsed=0
  while (( elapsed < limit )); do
    if curl -fsS --max-time 5 "$health_url" >"$stage/health.json" 2>/dev/null; then
      "$python_bin" - "$stage/health.json" "$version" "$commit" <<'PY'
import json, sys
path, version, commit = sys.argv[1:]
with open(path, encoding='utf-8') as handle:
    data = json.load(handle).get('data', {})
build = data.get('build', {})
if data.get('ready') is not True:
    raise SystemExit('backend is not ready')
if build.get('version') != version:
    raise SystemExit(f"backend version mismatch: {build.get('version')} != {version}")
if build.get('commit') != commit and build.get('commit') != commit[:8]:
    raise SystemExit(f"backend commit mismatch: {build.get('commit')} != {commit}")
PY
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

rollback() {
  local original_status=$?
  trap - ERR
  set +e
  if (( changes_started == 1 && committed == 0 )); then
    echo "deployment failed; rolling back" >&2
    systemctl stop "$service" >/dev/null 2>&1 || true
    if (( backend_switched == 1 )) && [[ -f "$backup/infinite-canvas-backend" ]]; then
      install -m 0755 -o root -g root "$backup/infinite-canvas-backend" "$root/bin/infinite-canvas-backend"
    fi
    if (( agent_switched == 1 )) && [[ -d "$backup/agent-host" ]]; then
      rm -rf -- "$root/bin/agent-host"
      mv "$backup/agent-host" "$root/bin/agent-host"
    fi
    if (( web_switched == 1 )) && [[ -d "$prev_web" ]]; then
      rm -rf -- "$root/web-dist.failed-$stamp"
      mv "$root/web-dist" "$root/web-dist.failed-$stamp" 2>/dev/null || true
      mv "$prev_web" "$root/web-dist"
      nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
    fi
    [[ -f "$backup/RELEASE.json" ]] && cp -a "$backup/RELEASE.json" "$root/RELEASE.json"
    [[ -f "$backup/VERSION" ]] && cp -a "$backup/VERSION" "$root/VERSION"
    [[ -f "$backup/open_ai_canvas.db" ]] && cp -a "$backup/open_ai_canvas.db" "$db_path"
    systemctl start "$service" >/dev/null 2>&1 || true
    wait_health "$health_timeout" >/dev/null 2>&1 || true
    echo "rollback completed; previous release restored" >&2
  fi
  rm -rf -- "$stage"
  exit "$original_status"
}
trap rollback ERR
trap 'rm -rf -- "$stage"' EXIT

actual_sha="$(sha256sum "$bundle" | awk '{print $1}')"
[[ "$actual_sha" == "${expected_sha,,}" ]] || { echo "bundle SHA256 mismatch" >&2; exit 1; }
tar -xzf "$bundle" -C "$stage"
(
  cd "$stage"
  sha256sum -c SHA256SUMS
)

readarray -t meta < <(
  "$python_bin" - "$stage/build-manifest.json" "$stage" <<'PY' | tr -d '\r'
import json, os, re, sys, tarfile

manifest_path, stage = sys.argv[1:]
with open(manifest_path, encoding='utf-8') as handle:
    data = json.load(handle)
required = ('version', 'commit', 'buildTime', 'frontendEntry', 'backend', 'web', 'agentHost')
if data.get('format') != 'aicyld-canvas-hosted-release-v1':
    raise SystemExit('unsupported release bundle format')
for key in required:
    if not str(data.get(key, '')).strip():
        raise SystemExit(f'manifest field missing: {key}')
commit = data['commit']
if not re.fullmatch(r'[0-9a-fA-F]{40,64}', commit):
    raise SystemExit('manifest commit is invalid')
for key in ('backend', 'web', 'agentHost'):
    path = os.path.join(stage, data[key])
    if not os.path.isfile(path):
        raise SystemExit(f'manifest artifact missing: {key}')

with tarfile.open(os.path.join(stage, data['web']), 'r:gz') as archive:
    web_members = {item.name.removeprefix('./'): item for item in archive.getmembers()}
    if 'index.html' not in web_members or 'version.json' not in web_members:
        raise SystemExit('web archive incomplete')
    index = archive.extractfile(web_members['index.html']).read().decode('utf-8')
    frontend_manifest = json.load(archive.extractfile(web_members['version.json']))
if data['frontendEntry'] not in index:
    raise SystemExit('frontend entry is absent from index.html')
entry_name = data['frontendEntry'].lstrip('/')
if entry_name not in web_members:
    raise SystemExit(f"frontend entry file is missing: {entry_name}")
if frontend_manifest.get('version') != data['version']:
    raise SystemExit('frontend manifest version mismatch')
if frontend_manifest.get('commit') not in (commit, commit[:8]):
    raise SystemExit('frontend manifest commit mismatch')

with tarfile.open(os.path.join(stage, data['agentHost']), 'r:gz') as archive:
    names = {item.name.lstrip('./') for item in archive.getmembers()}
required_agent = {'server.mjs', 'package.json', 'runtime/bin/node', 'node_modules/@earendil-works/pi-coding-agent/package.json'}
missing = sorted(required_agent - names)
if missing:
    raise SystemExit('agent host archive incomplete: ' + ', '.join(missing))

print(data['version'])
print(commit)
print(data['buildTime'])
print(data['frontendEntry'])
print(data.get('goVersion', 'unknown'))
print(data.get('nodeVersion', 'unknown'))
PY
)
version="${meta[0]}"
commit="${meta[1]}"
build_time="${meta[2]}"
entry="${meta[3]}"
go_version="${meta[4]}"
node_version="${meta[5]}"

if (( verify_only == 1 )); then
  echo "verified=1"
  echo "version=$version"
  echo "commit=$commit"
  echo "entry=$entry"
  echo "sha256=$actual_sha"
  exit 0
fi

command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 2; }

[[ -f "$root/web-dist/index.html" && -f "$root/bin/infinite-canvas-backend" && -d "$root/bin/agent-host" ]] || {
  echo "production canvas layout is incomplete" >&2
  exit 1
}

if (( wait_active > 0 )); then
  elapsed=0
  while (( elapsed <= wait_active )); do
    if curl -fsS --max-time 5 "$health_url" >"$stage/current-health.json" 2>/dev/null; then
      active="$(
        "$python_bin" - "$stage/current-health.json" <<'PY' | tr -d '\r'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    print(int(json.load(handle).get('data', {}).get('activeWorkerTasks', 0)))
PY
      )"
      echo "activeWorkerTasks=$active waited=${elapsed}s"
      (( active == 0 )) && break
    else
      echo "current backend health check failed" >&2
      exit 1
    fi
    sleep 10
    elapsed=$((elapsed + 10))
  done
  (( active == 0 )) || { echo "active tasks did not drain within ${wait_active}s" >&2; exit 1; }
fi

backup="$root/backups/pre-release-$version-$stamp"
install -d -m 0700 "$backup"
cp -a "$root/bin/infinite-canvas-backend" "$backup/infinite-canvas-backend"
cp -a "$root/RELEASE.json" "$backup/RELEASE.json"
cp -a "$root/VERSION" "$backup/VERSION"
if (( skip_db_backup == 0 )); then
  [[ -f "$db_path" ]] || { echo "database not found: $db_path" >&2; exit 1; }
  "$python_bin" - "$db_path" "$backup/open_ai_canvas.db" <<'PY'
import sqlite3, sys
source, destination = sys.argv[1:]
src = sqlite3.connect(f'file:{source}?mode=ro', uri=True)
dst = sqlite3.connect(destination)
try:
    src.backup(dst)
    result = dst.execute('PRAGMA quick_check').fetchone()[0]
    if result != 'ok':
        raise SystemExit(f'database quick_check failed: {result}')
finally:
    dst.close(); src.close()
PY
fi

new_web="$root/web-dist.new-$version-$stamp"
prev_web="$root/.web-dist.prev-$version-$stamp"
mkdir -p "$new_web"
tar -xzf "$stage/web-dist.tar.gz" -C "$new_web"
test -f "$new_web/index.html"
test -f "$new_web/version.json"
if [[ -d "$root/web-dist/static" ]]; then
  mkdir -p "$new_web/static"
  cp -an "$root/web-dist/static/." "$new_web/static/"
fi
chown -R www-data:www-data "$new_web"
find "$new_web" -type d -exec chmod 755 {} +
find "$new_web" -type f -exec chmod 644 {} +

new_agent="$root/bin/agent-host.new-$version-$stamp"
mkdir -p "$new_agent"
tar -xzf "$stage/agent-host.tar.gz" -C "$new_agent"
chown -R aicyld:aicyld "$new_agent"
find "$new_agent" -type f -exec chmod u+rw,go+r {} +
chmod 0755 "$new_agent/runtime/bin/node"

new_backend="$root/bin/infinite-canvas-backend.new-$version-$stamp"
install -m 0755 -o root -g root "$stage/infinite-canvas-backend" "$new_backend"

changes_started=1
systemctl stop "$service"
mv "$root/bin/agent-host" "$backup/agent-host"
agent_switched=1
mv "$new_agent" "$root/bin/agent-host"
mv -f "$new_backend" "$root/bin/infinite-canvas-backend"
backend_switched=1
systemctl start "$service"
wait_health "$health_timeout"

test ! -e "$prev_web"
mv "$root/web-dist" "$prev_web"
mv "$new_web" "$root/web-dist"
web_switched=1
nginx -t
systemctl reload nginx

curl -fsS --max-time 20 "$public_url/" | grep -Fq "$entry"
curl -fsS --max-time 20 "$public_url/version.json" >"$stage/public-version.json"
"$python_bin" - "$stage/public-version.json" "$version" "$commit" <<'PY'
import json, sys
path, version, commit = sys.argv[1:]
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)
if data.get('version') != version:
    raise SystemExit('public version mismatch')
if data.get('commit') not in (commit, commit[:8]):
    raise SystemExit('public commit mismatch')
PY

"$python_bin" - "$root" "$version" "$commit" "$build_time" "$go_version" "$node_version" "$entry" <<'PY'
import json, sys
root, version, commit, build_time, go_version, node_version, entry = sys.argv[1:]
release_path = f'{root}/RELEASE.json'
with open(release_path, encoding='utf-8') as handle:
    release = json.load(handle)
release.update({
    'version': version,
    'commit': commit,
    'buildTime': build_time,
    'goVersion': go_version,
    'nodeVersion': node_version,
    'hosted': True,
    'frontendCommit': commit[:8],
    'frontendBuildTime': build_time,
    'frontendEntry': entry,
    'backendVersion': version,
    'backendCommit': commit,
    'agentHostCommit': commit,
    'backendBuildTime': build_time,
})
with open(release_path, 'w', encoding='utf-8') as handle:
    json.dump(release, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
with open(f'{root}/VERSION', 'w', encoding='utf-8') as handle:
    handle.write(version + '\n')
PY

mkdir -p "$root/backups/bundles" "$root/backups/releases"
cp -a "$bundle" "$root/backups/bundles/$(basename "$bundle")"
cp -a "$stage/build-manifest.json" "$root/backups/releases/$version-$stamp.json"

committed=1
trap - ERR
echo "deployment=ok"
echo "version=$version"
echo "commit=$commit"
echo "entry=$entry"
echo "backup=$backup"
echo "previous_frontend=$prev_web"
