#!/usr/bin/env python3
"""Delete known secret-bearing objects from a partial OSS backup run."""

from __future__ import annotations

import argparse
import importlib.util
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
    root = Path(args.canvas_root)
    keys: list[str] = []
    for source in sorted((root / "backups").iterdir()):
        if source.is_file() and module.is_sensitive_backup_name(source.name):
            keys.append(f"{prefix}/backups/{source.name}")
    workspace = root / "data" / "workspace"
    if workspace.is_dir():
        for source in sorted(workspace.rglob("*")):
            if source.is_file():
                keys.append(f"{prefix}/data/workspace/{source.relative_to(workspace).as_posix()}")

    if not keys:
        print("no sensitive keys found")
        return 0
    for key in keys:
        client.delete(key)
        print(f"DELETED {key}")
    print(f"deleted={len(keys)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
