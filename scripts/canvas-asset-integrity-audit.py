#!/usr/bin/env python3
"""Audit active canvas media assets without modifying the database or files."""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AssetRow:
    asset_id: str
    user_id: str
    kind: str
    title: str
    storage_key: str
    resource_id: str
    provider: str
    object_key: str
    resource_size: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Path to open_ai_canvas.db")
    parser.add_argument("--resources", required=True, help="Resource root containing object keys")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero for missing local files or orphan assets as well as duplicates",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Maximum detail rows per finding category; 0 prints all (default: 50)",
    )
    return parser.parse_args()


def connect_readonly(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True)


def load_active_media_assets(connection: sqlite3.Connection) -> list[AssetRow]:
    rows = connection.execute(
        """
        SELECT a.id, a.user_id, a.kind, a.title,
               COALESCE(json_extract(a.payload_json, '$.data.storageKey'), ''),
               COALESCE(r.id, ''), COALESCE(r.provider, ''),
               COALESCE(r.object_key, ''), COALESCE(r.size, 0)
          FROM assets a
          LEFT JOIN resources r
            ON r.id = replace(json_extract(a.payload_json, '$.data.storageKey'), 'resource:', '')
         WHERE a.status <> 'archived'
           AND a.kind IN ('image', 'video', 'audio')
         ORDER BY a.id
        """
    ).fetchall()
    return [AssetRow(*row) for row in rows]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def limited(items: list[dict], limit: int) -> list[dict]:
    return items if limit <= 0 else items[:limit]


def group_duplicates(
    assets: list[AssetRow],
) -> list[dict]:
    groups: dict[tuple[str, str, str], list[AssetRow]] = collections.defaultdict(list)
    for asset in assets:
        if asset.storage_key:
            groups[(asset.user_id, asset.kind, asset.storage_key)].append(asset)
    findings = []
    for (user_id, kind, storage_key), rows in groups.items():
        if len(rows) < 2:
            continue
        findings.append(
            {
                "userId": user_id,
                "kind": kind,
                "storageKey": storage_key,
                "assetIds": [row.asset_id for row in rows],
                "titles": [row.title for row in rows],
            }
        )
    findings.sort(key=lambda item: (-len(item["assetIds"]), item["userId"], item["kind"]))
    return findings


def resource_path(resources_root: Path, object_key: str) -> Path | None:
    if not object_key:
        return None
    path = (resources_root / object_key).resolve()
    try:
        path.relative_to(resources_root.resolve())
    except ValueError:
        return None
    return path


def audit(db_path: str, resources_root: str) -> dict:
    root = Path(resources_root).resolve()
    connection = connect_readonly(db_path)
    try:
        assets = load_active_media_assets(connection)
    finally:
        connection.close()

    duplicate_resources = group_duplicates(assets)
    missing_files = []
    orphan_assets = []
    existing_files: dict[tuple[str, str, str], list[tuple[AssetRow, Path]]] = collections.defaultdict(list)

    for asset in assets:
        if not asset.resource_id:
            orphan_assets.append(
                {
                    "assetId": asset.asset_id,
                    "userId": asset.user_id,
                    "kind": asset.kind,
                    "title": asset.title,
                    "storageKey": asset.storage_key,
                }
            )
            continue
        if asset.provider != "local":
            continue
        path = resource_path(root, asset.object_key)
        if path is None or not path.is_file():
            missing_files.append(
                {
                    "assetId": asset.asset_id,
                    "resourceId": asset.resource_id,
                    "userId": asset.user_id,
                    "kind": asset.kind,
                    "title": asset.title,
                    "objectKey": asset.object_key,
                }
            )
            continue
        existing_files[(asset.user_id, asset.kind, str(asset.resource_size))].append((asset, path))

    hash_cache: dict[Path, str] = {}
    content_groups: dict[tuple[str, str, str], list[tuple[AssetRow, Path]]] = collections.defaultdict(list)
    files_hashed = 0
    for rows in existing_files.values():
        if len(rows) < 2:
            continue
        for asset, path in rows:
            digest = hash_cache.get(path)
            if digest is None:
                digest = file_sha256(path)
                hash_cache[path] = digest
                files_hashed += 1
            content_groups[(asset.user_id, asset.kind, digest)].append((asset, path))

    duplicate_contents = []
    for (user_id, kind, digest), rows in content_groups.items():
        if len(rows) < 2:
            continue
        duplicate_contents.append(
            {
                "userId": user_id,
                "kind": kind,
                "sha256": digest,
                "assetIds": [asset.asset_id for asset, _ in rows],
                "objectKeys": [asset.object_key for asset, _ in rows],
            }
        )
    duplicate_contents.sort(key=lambda item: (-len(item["assetIds"]), item["userId"], item["kind"]))
    missing_files.sort(key=lambda item: (item["userId"], item["kind"], item["objectKey"]))
    orphan_assets.sort(key=lambda item: (item["userId"], item["assetId"]))

    duplicate_ok = not duplicate_resources and not duplicate_contents
    integrity_ok = not missing_files and not orphan_assets
    return {
        "ok": duplicate_ok and integrity_ok,
        "duplicateOk": duplicate_ok,
        "integrityOk": integrity_ok,
        "db": str(Path(db_path).resolve()),
        "resourcesRoot": str(root),
        "activeMediaAssets": len(assets),
        "filesHashed": files_hashed,
        "duplicateResourceGroups": len(duplicate_resources),
        "duplicateResourceAssets": sum(len(item["assetIds"]) for item in duplicate_resources),
        "contentDuplicateGroups": len(duplicate_contents),
        "contentDuplicateAssets": sum(len(item["assetIds"]) for item in duplicate_contents),
        "missingResourceFiles": len(missing_files),
        "orphanAssets": len(orphan_assets),
        "duplicateResources": duplicate_resources,
        "contentDuplicates": duplicate_contents,
        "missingFiles": missing_files,
        "orphans": orphan_assets,
    }


def print_report(report: dict, limit: int) -> None:
    print(f"active media assets: {report['activeMediaAssets']}")
    print(f"duplicate resource groups: {report['duplicateResourceGroups']}")
    print(f"content duplicate groups: {report['contentDuplicateGroups']}")
    print(f"missing resource files: {report['missingResourceFiles']}")
    print(f"orphan assets: {report['orphanAssets']}")
    print(f"files hashed: {report['filesHashed']}")
    for key in ("duplicateResources", "contentDuplicates", "missingFiles", "orphans"):
        rows = report[key]
        if not rows:
            continue
        shown = limited(rows, limit)
        print(f"\n{key} ({len(rows)}; showing {len(shown)}):")
        for row in shown:
            print(json.dumps(row, ensure_ascii=False, sort_keys=True))


def main() -> int:
    args = parse_args()
    report = audit(args.db, args.resources)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_report(report, args.limit)
    duplicate_problem = not report["duplicateOk"]
    integrity_problem = not report["integrityOk"]
    if duplicate_problem or (args.strict and integrity_problem):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
