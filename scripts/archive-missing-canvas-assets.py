#!/usr/bin/env python3
"""Archive active canvas media assets whose local resource file is missing.

The command is dry-run by default. With --apply it creates a consistent SQLite
backup, marks only the affected asset records as archived, and leaves every
resource record, object key, canvas document and historical snapshot intact.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BrokenAsset:
    asset_id: str
    user_id: str
    kind: str
    title: str
    storage_key: str
    resource_id: str
    object_key: str
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Path to open_ai_canvas.db")
    parser.add_argument("--resources", required=True, help="Resource root containing object keys")
    parser.add_argument("--apply", action="store_true", help="Archive the broken asset records")
    parser.add_argument("--backup", help="Consistent SQLite backup path used with --apply")
    parser.add_argument("--limit", type=int, default=50, help="Maximum rows to print; 0 prints all")
    return parser.parse_args()


def connect_readonly(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True)


def connect_for_write(path: str) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=30)
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def resource_path(resources_root: Path, object_key: str) -> Path | None:
    if not object_key:
        return None
    path = (resources_root / object_key).resolve()
    try:
        path.relative_to(resources_root.resolve())
    except ValueError:
        return None
    return path


def find_broken_assets(db_path: str, resources_root: str) -> list[BrokenAsset]:
    connection = connect_readonly(db_path)
    root = Path(resources_root).resolve()
    try:
        rows = connection.execute(
            """
            SELECT a.id, a.user_id, a.kind, a.title,
                   COALESCE(json_extract(a.payload_json, '$.data.storageKey'), ''),
                   COALESCE(r.id, ''), COALESCE(r.provider, ''),
                   COALESCE(r.object_key, '')
              FROM assets a
              LEFT JOIN resources r
                ON r.id = replace(json_extract(a.payload_json, '$.data.storageKey'), 'resource:', '')
             WHERE a.status <> 'archived'
               AND a.kind IN ('image', 'video', 'audio')
             ORDER BY a.user_id, a.kind, a.id
            """
        ).fetchall()
    finally:
        connection.close()

    broken = []
    for asset_id, user_id, kind, title, storage_key, resource_id, provider, object_key in rows:
        if not resource_id:
            broken.append(
                BrokenAsset(
                    asset_id, user_id, kind, title, storage_key, "", object_key, "resource_missing"
                )
            )
            continue
        if provider != "local":
            continue
        path = resource_path(root, object_key)
        if path is None or not path.is_file():
            broken.append(
                BrokenAsset(
                    asset_id, user_id, kind, title, storage_key, resource_id, object_key, "file_missing"
                )
            )
    return broken


def backup_database(source_path: str, destination_path: str) -> None:
    destination = Path(destination_path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    source = connect_readonly(source_path)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
        target.commit()
    finally:
        target.close()
        source.close()


def archive_assets(db_path: str, asset_ids: list[str], backup_path: str) -> int:
    if not asset_ids:
        return 0
    backup_database(db_path, backup_path)
    connection = connect_for_write(db_path)
    try:
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        with connection:
            before = connection.total_changes
            connection.executemany(
                "UPDATE assets SET status = 'archived', updated_at = ? WHERE id = ? AND status <> 'archived'",
                ((now, asset_id) for asset_id in asset_ids),
            )
            changed = connection.total_changes - before
        if changed != len(asset_ids):
            raise RuntimeError(f"archived {changed} rows, expected {len(asset_ids)}")
        return changed
    finally:
        connection.close()


def print_report(broken: list[BrokenAsset], limit: int) -> None:
    print(f"active broken assets: {len(broken)}")
    for reason in ("file_missing", "resource_missing"):
        rows = [item for item in broken if item.reason == reason]
        print(f"  {reason}: {len(rows)}")
    shown = broken if limit <= 0 else broken[:limit]
    for item in shown:
        print(
            f"  {item.asset_id} user={item.user_id} kind={item.kind} "
            f"reason={item.reason} title={item.title!r} objectKey={item.object_key!r}"
        )


def main() -> int:
    args = parse_args()
    broken = find_broken_assets(args.db, args.resources)
    print_report(broken, args.limit)
    if not args.apply:
        print("dry run only; pass --apply to archive these asset records")
        return 0
    if not broken:
        print("nothing to archive")
        return 0

    backup_path = args.backup or str(
        Path(args.db).resolve().with_name(
            f"open_ai_canvas.db.pre-missing-assets-{dt.datetime.now():%Y%m%d-%H%M%S}"
        )
    )
    archived = archive_assets(args.db, [item.asset_id for item in broken], backup_path)
    remaining = find_broken_assets(args.db, args.resources)
    if remaining:
        raise RuntimeError(f"cleanup incomplete: {len(remaining)} broken active assets remain")
    print(f"backup: {backup_path}")
    print(f"archived assets: {archived}")
    print("resource records and files were not modified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
