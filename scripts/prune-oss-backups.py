#!/usr/bin/env python3
"""Prune expired AICYLD Canvas full-backup runs from OSS.

Each run has an immutable prefix and a local manifest under
backups/oss-manifests. This utility uses those manifests as the deletion
authority; it does not guess object keys by listing or parsing OSS.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import shutil
from pathlib import Path


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("canvas_backup_to_oss", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_created(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def manifest_key_set(manifest: dict[str, object], shared: bool | None = None) -> set[str]:
    result: set[str] = set()
    objects = manifest.get("objects", [])
    if not isinstance(objects, list):
        return result
    for item in objects:
        if not isinstance(item, dict):
            continue
        is_shared = bool(item.get("shared"))
        if shared is not None and is_shared != shared:
            continue
        key = str(item.get("key", ""))
        if key:
            result.add(key)
    return result


def deletable_shared_keys(candidates: list[dict[str, object]], live: list[dict[str, object]]) -> set[str]:
    candidate_shared: set[str] = set()
    for manifest in candidates:
        candidate_shared.update(manifest_key_set(manifest, shared=True))
    live_shared: set[str] = set()
    for manifest in live:
        live_shared.update(manifest_key_set(manifest, shared=True))
    return candidate_shared - live_shared


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canvas-root", default="/srv/aicyld/canvas")
    parser.add_argument("--env-file", default="/srv/aicyld/canvas/canvas.env")
    parser.add_argument("--backup-script", default="/srv/aicyld/canvas/bin/backup-to-oss.py")
    parser.add_argument("--keep-days", type=int, default=30)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.keep_days < 1:
        raise SystemExit("--keep-days must be >= 1")

    root = Path(args.canvas_root).resolve()
    manifest_dir = root / "backups" / "oss-manifests"
    pruned_dir = manifest_dir / "pruned"
    manifests = sorted(manifest_dir.glob("*.json"))
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=args.keep_days)
    candidates = []
    for path in manifests:
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            created = parse_created(str(manifest.get("createdAt", "")))
        except Exception as exc:
            print(f"SKIP unreadable manifest {path}: {exc}")
            continue
        if created < cutoff:
            candidates.append((path, manifest, created))

    print(f"manifest_dir={manifest_dir}")
    print(f"keep_days={args.keep_days} cutoff={cutoff.isoformat()}")
    print(f"manifests={len(manifests)} candidates={len(candidates)}")
    for path, manifest, created in candidates:
        print(f"CANDIDATE {path} created={created.isoformat()} objects={len(manifest.get('objects', []))}")
    if not candidates or not args.apply:
        print("dry-run: add --apply to delete expired OSS runs")
        return 0

    module = load_module(Path(args.backup_script))
    env = module.load_env(Path(args.env_file))
    client = module.OSSClient(
        env["CANVAS_OSS_ENDPOINT"],
        env["CANVAS_OSS_BUCKET"],
        env["CANVAS_OSS_ACCESS_KEY"],
        env["CANVAS_OSS_SECRET_KEY"],
        env.get("CANVAS_OSS_PATH_PREFIX", "canvas"),
    )
    path_prefix = env.get("CANVAS_OSS_PATH_PREFIX", "canvas").strip("/")
    pruned_dir.mkdir(parents=True, exist_ok=True)
    total_deleted = 0
    for path, manifest, created in candidates:
        run_id = path.stem
        base = "/".join(part for part in (path_prefix, "backups", "daily", run_id) if part)
        for key in sorted(manifest_key_set(manifest, shared=False)):
            client.delete(key)
            total_deleted += 1
        client.delete(f"{base}/manifest.json")
        client.delete(f"{base}/manifest.json.sha256")
        shutil.move(str(path), str(pruned_dir / path.name))
        print(f"PRUNED {run_id} objects={len(manifest.get('objects', []))}")

    live_manifests: list[dict[str, object]] = []
    live_unknown = False
    for path in sorted(manifest_dir.glob("*.json")):
        try:
            live_manifests.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception as exc:
            live_unknown = True
            print(f"KEEP shared objects because live manifest is unreadable: {path}: {exc}")
    shared_deleted = 0
    if live_unknown:
        print("shared object GC skipped because a live manifest could not be read")
    else:
        shared_keys = deletable_shared_keys([manifest for _, manifest, _ in candidates], live_manifests)
        for key in sorted(shared_keys):
            client.delete(key)
            shared_deleted += 1
        print(f"shared_objects_deleted={shared_deleted}")
    print(f"pruned_runs={len(candidates)} deleted_run_objects={total_deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
