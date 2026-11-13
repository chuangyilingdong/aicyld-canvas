#!/usr/bin/env bash
set -euo pipefail

# Package one deployable Canvas release. All inputs must come from the same
# commit; the deployment script verifies the outer bundle hash again on-site.
usage() {
  cat >&2 <<'EOF'
Usage:
  package-canvas-release.sh \
    --version VERSION \
    --commit FULL_SHA \
    --backend PATH \
    --web PATH \
    --agent-host PATH \
    [--build-time ISO8601] \
    [--go-version VERSION] \
    [--node-version VERSION] \
    [--output PATH]
EOF
  exit 2
}

version=""
commit=""
backend=""
web=""
agent_host=""
build_time=""
go_version="unknown"
node_version="unknown"
output=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) version="${2:-}"; shift 2 ;;
    --commit) commit="${2:-}"; shift 2 ;;
    --backend) backend="${2:-}"; shift 2 ;;
    --web) web="${2:-}"; shift 2 ;;
    --agent-host) agent_host="${2:-}"; shift 2 ;;
    --build-time) build_time="${2:-}"; shift 2 ;;
    --go-version) go_version="${2:-}"; shift 2 ;;
    --node-version) node_version="${2:-}"; shift 2 ;;
    --output) output="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$version" && -n "$commit" && -n "$backend" && -n "$web" && -n "$agent_host" ]] || usage
[[ "$commit" =~ ^[0-9a-fA-F]{40,64}$ ]] || { echo "commit must be a full Git SHA" >&2; exit 2; }
[[ -f "$backend" && -f "$web" && -f "$agent_host" ]] || { echo "release input file is missing" >&2; exit 2; }
python_bin="${PYTHON_BIN:-}"
if [[ -z "$python_bin" ]]; then
  if command -v python3 >/dev/null; then python_bin=python3
  elif command -v python >/dev/null; then python_bin=python
  else echo "python3 or python is required" >&2; exit 2
  fi
fi
command -v tar >/dev/null || { echo "tar is required" >&2; exit 2; }

if [[ -z "$build_time" ]]; then
  build_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
short="${commit:0:8}"
if [[ -z "$output" ]]; then
  output="$(pwd)/aicyld-canvas-${version}-${short}.tar.gz"
fi
mkdir -p "$(dirname "$output")"

stage="$(mktemp -d "${TMPDIR:-/tmp}/canvas-release.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT

cp "$backend" "$stage/infinite-canvas-backend"
chmod 0755 "$stage/infinite-canvas-backend"
cp "$web" "$stage/web-dist.tar.gz"
cp "$agent_host" "$stage/agent-host.tar.gz"

"$python_bin" - "$stage" "$version" "$commit" "$build_time" "$go_version" "$node_version" <<'PY'
import json, os, re, sys, tarfile

stage, version, commit, build_time, go_version, node_version = sys.argv[1:]

def members(path):
    with tarfile.open(path, "r:gz") as archive:
        return {item.name.lstrip("./"): item for item in archive.getmembers()}

web_members = members(os.path.join(stage, "web-dist.tar.gz"))
if "index.html" not in web_members or "version.json" not in web_members:
    raise SystemExit("web-dist.tar.gz must contain index.html and version.json")

with tarfile.open(os.path.join(stage, "web-dist.tar.gz"), "r:gz") as archive:
    index = archive.extractfile(web_members["index.html"]).read().decode("utf-8")
    manifest = json.load(archive.extractfile(web_members["version.json"]))

entry_match = re.search(r'/static/index-[^"\']+\.js', index)
if not entry_match:
    raise SystemExit("frontend entry was not found in index.html")
entry_name = entry_match.group(0).lstrip('/')
if entry_name not in web_members:
    raise SystemExit(f"frontend entry file is missing: {entry_name}")
if manifest.get("version") != version:
    raise SystemExit(f"frontend version mismatch: {manifest.get('version')} != {version}")
if manifest.get("commit") != commit[:8] and manifest.get("commit") != commit:
    raise SystemExit(f"frontend commit mismatch: {manifest.get('commit')} != {commit[:8]}")

agent_members = members(os.path.join(stage, "agent-host.tar.gz"))
required_agent = {
    "server.mjs",
    "package.json",
    "runtime/bin/node",
    "node_modules/@earendil-works/pi-coding-agent/package.json",
}
missing = sorted(required_agent - set(agent_members))
if missing:
    raise SystemExit("agent-host.tar.gz is incomplete: " + ", ".join(missing))

payload = {
    "format": "aicyld-canvas-hosted-release-v1",
    "version": version,
    "commit": commit,
    "buildTime": build_time,
    "frontendEntry": entry_match.group(0),
    "backend": "infinite-canvas-backend",
    "web": "web-dist.tar.gz",
    "agentHost": "agent-host.tar.gz",
    "goVersion": go_version,
    "nodeVersion": node_version,
}
with open(os.path.join(stage, "build-manifest.json"), "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

(
  cd "$stage"
  sha256sum build-manifest.json infinite-canvas-backend web-dist.tar.gz agent-host.tar.gz > SHA256SUMS
)

tar -czf "$output" -C "$stage" .
sha256sum "$output" | awk '{print $1}' > "${output}.sha256"
echo "bundle=$output"
echo "sha256=$(cat "${output}.sha256")"
