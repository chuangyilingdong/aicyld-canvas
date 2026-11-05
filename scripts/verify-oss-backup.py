#!/usr/bin/env python3
"""Verify an AICYLD Canvas OSS backup manifest and its critical objects."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("canvas_backup_to_oss", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--canvas-root", default="/srv/aicyld/canvas")
    parser.add_argument("--env-file", default="/srv/aicyld/canvas/canvas.env")
    parser.add_argument("--backup-script", default="/srv/aicyld/canvas/src/scripts/backup-to-oss.py")
    args = parser.parse_args()

    module = load_module(Path(args.backup_script))
    env = module.load_env(Path(args.env_file))
    client = module.OSSClient(
        env["CANVAS_OSS_ENDPOINT"],
        env["CANVAS_OSS_BUCKET"],
        env["CANVAS_OSS_ACCESS_KEY"],
        env["CANVAS_OSS_SECRET_KEY"],
        env.get("CANVAS_OSS_PATH_PREFIX", "canvas"),
    )
    prefix = args.prefix.strip("/")
    local_manifest = Path(args.manifest)
    local_bytes = local_manifest.read_bytes()
    local_sha = hashlib.sha256(local_bytes).hexdigest()
    manifest = json.loads(local_bytes)
    objects = manifest.get("objects", [])
    total = sum(int(item.get("size", 0)) for item in objects)
    print(f"manifest_sha256={local_sha}")
    print(f"objects={len(objects)} bytes={total}")

    sensitive_markers = ("canvas.env", "platform-channels", "workspace", "agent_host_token", "agent_owner_token", ".settings-key", "local-model-config")
    bad = []
    for item in objects:
        key = str(item.get("key", ""))
        if any(marker in key for marker in sensitive_markers):
            bad.append(key)
    if bad:
        raise SystemExit("manifest contains sensitive keys:\n" + "\n".join(bad))

    status, _, remote_bytes = client._request("GET", f"{prefix}/manifest.json")
    if status != 200:
        raise SystemExit(f"manifest GET returned {status}")
    remote_sha = hashlib.sha256(remote_bytes).hexdigest()
    print(f"remote_manifest_sha256={remote_sha}")
    if remote_sha != local_sha:
        raise SystemExit("local and remote manifest hashes differ")

    required = (
        "db/open_ai_canvas.db",
        "release/web-dist-current.tar.gz",
        "release/web-dist-rollback-extra.tar.zst",
        "bin/agent-host-runtime.tar.zst",
    )
    keys = {str(item.get("key", "")) for item in objects}
    for relative in required:
        key = f"{prefix}/{relative}"
        if key not in keys:
            raise SystemExit(f"critical object missing from manifest: {key}")
        exists, size = client.head(key)
        if not exists or size <= 0:
            raise SystemExit(f"critical object missing from OSS: {key}")
        print(f"critical_ok {key} size={size}")
    print("verification=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
