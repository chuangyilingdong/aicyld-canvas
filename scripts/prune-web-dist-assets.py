#!/usr/bin/env python3
"""Remove web-dist files that are not referenced by retained version manifests."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_manifest(directory: Path) -> set[str]:
    path = directory / "version.json"
    if not path.is_file():
        raise SystemExit(f"缺少 version.json: {directory}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"无法读取 {path}: {exc}") from exc
    files = payload.get("files")
    if not isinstance(files, list):
        raise SystemExit(f"{path} 缺少 files 数组")
    result: set[str] = set()
    for raw in files:
        if not isinstance(raw, str):
            raise SystemExit(f"{path} 包含非字符串文件路径")
        relative = Path(raw)
        if relative.is_absolute() or ".." in relative.parts:
            raise SystemExit(f"{path} 包含越界路径: {raw}")
        result.add(relative.as_posix())
    result.add("version.json")
    return result


def retained_dirs(root: Path, keep_previous: int) -> list[Path]:
    current = root / "web-dist"
    if not current.is_dir():
        raise SystemExit(f"web-dist 不存在: {current}")
    previous = [
        path
        for path in root.iterdir()
        if path.is_dir()
        and not path.is_symlink()
        and (path.name.startswith(".web-dist.prev-") or path.name.startswith("web-dist.prev-"))
    ]
    previous.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [current, *previous[:keep_previous]]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canvas-root", default="/srv/aicyld/canvas")
    parser.add_argument("--keep-previous", type=int, default=2)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.keep_previous < 0:
        raise SystemExit("--keep-previous 必须大于等于 0")

    root = Path(args.canvas_root).resolve()
    dirs = retained_dirs(root, args.keep_previous)
    referenced: set[str] = set()
    for directory in dirs:
        manifest_files = load_manifest(directory)
        referenced.update(manifest_files)
        print(f"KEEP_MANIFEST {directory.name} files={len(manifest_files)}")

    web = root / "web-dist"
    static_root = web / "static"
    if not static_root.is_dir():
        raise SystemExit(f"web-dist/static 不存在: {static_root}")
    candidates = [
        path
        for path in static_root.rglob("*")
        if path.is_file() and not path.is_symlink() and path.relative_to(web).as_posix() not in referenced
    ]
    reclaim = sum(path.stat().st_size for path in candidates)
    print(f"retained_versions={len(dirs)} referenced_files={len(referenced)} delete_files={len(candidates)} reclaim_bytes={reclaim}")
    if not args.apply:
        for path in candidates[:20]:
            print(f"WOULD_DELETE {path.relative_to(root)}")
        if len(candidates) > 20:
            print(f"WOULD_DELETE ... {len(candidates) - 20} more")
        print("dry-run: add --apply to delete")
        return 0

    for path in candidates:
        path.unlink()
        print(f"DELETE {path.relative_to(root)}")
    for directory in sorted((path for path in web.rglob("*") if path.is_dir()), key=lambda path: len(path.parts), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass
    print(f"deleted_files={len(candidates)} reclaimed_bytes={reclaim}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
