#!/usr/bin/env python3
"""Find or archive active canvas assets whose resources contain identical bytes.

The normal upload path now uses a content-derived idempotency key, but older
data can still contain multiple resources for the same file. This maintenance
tool is dry-run by default. With --apply it rewrites canvas references and
archives the redundant asset records; resource files are never deleted.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path


REFERENCE_KEYS = {
    "assetId",
    "materializedAssetId",
    "primaryAssetId",
    "sourceAssetId",
    "resolvedAssetId",
}


@dataclass(frozen=True)
class AssetRow:
    id: str
    user_id: str
    kind: str
    title: str
    status: str
    payload_json: str
    updated_at: str
    source: str
    object_key: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, help="Path to open_ai_canvas.db")
    parser.add_argument("--resources", required=True, help="Resource root containing object keys")
    parser.add_argument("--apply", action="store_true", help="Archive duplicates and rewrite references")
    parser.add_argument("--backup", help="Optional consistent SQLite backup path used with --apply")
    return parser.parse_args()


def connect_readonly(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True)


def backup_database(source: sqlite3.Connection, destination: str) -> None:
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
        target.commit()
    finally:
        target.close()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def collect_asset_ids(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in REFERENCE_KEYS and isinstance(child, str) and child:
                found.add(child)
            found.update(collect_asset_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(collect_asset_ids(child))
    return found


def rewrite_asset_ids(value: object, mapping: dict[str, str]) -> bool:
    changed = False
    if isinstance(value, dict):
        for key, child in value.items():
            if key in REFERENCE_KEYS and isinstance(child, str) and child in mapping:
                value[key] = mapping[child]
                changed = True
                continue
            if rewrite_asset_ids(child, mapping):
                changed = True
    elif isinstance(value, list):
        for child in value:
            if rewrite_asset_ids(child, mapping):
                changed = True
    return changed


def load_assets(connection: sqlite3.Connection) -> list[AssetRow]:
    rows = connection.execute(
        """
        SELECT a.id, a.user_id, a.kind, a.title, a.status, a.payload_json,
               a.updated_at, COALESCE(json_extract(a.payload_json, '$.source'), ''),
               r.object_key
          FROM assets a
          JOIN resources r
            ON r.id = replace(json_extract(a.payload_json, '$.data.storageKey'), 'resource:', '')
         WHERE a.status <> 'archived'
           AND a.kind IN ('image', 'video', 'audio')
        """
    ).fetchall()
    return [AssetRow(*row) for row in rows]


def load_reference_counts(connection: sqlite3.Connection) -> dict[str, int]:
    counts: collections.Counter[str] = collections.Counter()
    for table in ("canvas_projects", "canvas_snapshots"):
        for (payload_json,) in connection.execute(f"SELECT payload_json FROM {table}"):
            try:
                payload = json.loads(payload_json or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
            counts.update(collect_asset_ids(payload))
    for (asset_id,) in connection.execute("SELECT asset_id FROM project_asset_links"):
        counts[asset_id] += 1
    for (asset_id,) in connection.execute(
        "SELECT resolved_asset_id FROM project_asset_candidates WHERE resolved_asset_id IS NOT NULL"
    ):
        counts[asset_id] += 1
    return dict(counts)


def canonical_key(
    asset: AssetRow,
    reference_counts: dict[str, int],
    version_counts: dict[str, int],
) -> tuple:
    return (
        reference_counts.get(asset.id, 0),
        version_counts.get(asset.id, 0),
        1 if asset.id.startswith("generation_") else 0,
        1 if asset.status == "confirmed" else 0,
        asset.updated_at or "",
        asset.id,
    )


def build_mappings(
    assets: list[AssetRow],
    resources_root: Path,
    reference_counts: dict[str, int],
    version_counts: dict[str, int],
) -> tuple[collections.defaultdict[str, dict[str, str]], list[tuple[str, list[AssetRow]]], list[str]]:
    groups: collections.defaultdict[tuple[str, str, str], list[AssetRow]] = collections.defaultdict(list)
    missing: list[str] = []
    for asset in assets:
        path = resources_root / asset.object_key
        if not path.is_file():
            missing.append(f"{asset.id}:{asset.object_key}")
            continue
        groups[(asset.user_id, asset.kind, file_sha256(path))].append(asset)

    mappings: collections.defaultdict[str, dict[str, str]] = collections.defaultdict(dict)
    duplicate_groups: list[tuple[str, list[AssetRow]]] = []
    for (user_id, kind, digest), rows in groups.items():
        if len(rows) < 2:
            continue
        canonical = max(rows, key=lambda row: canonical_key(row, reference_counts, version_counts))
        for row in rows:
            if row.id != canonical.id:
                mappings[user_id][row.id] = canonical.id
        duplicate_groups.append((f"{user_id}/{kind}/{digest[:12]}", sorted(rows, key=lambda row: row.id)))
    return mappings, duplicate_groups, missing


def rewrite_json_rows(
    connection: sqlite3.Connection,
    table: str,
    mapping: dict[str, str],
) -> int:
    changed = 0
    rows = connection.execute(f"SELECT id, user_id, payload_json FROM {table}").fetchall()
    for row_id, user_id, payload_json in rows:
        user_mapping = mapping
        if not user_mapping:
            continue
        try:
            payload = json.loads(payload_json or "{}")
        except json.JSONDecodeError as error:
            raise RuntimeError(f"cannot parse {table} {row_id}: {error}") from error
        if not rewrite_asset_ids(payload, user_mapping):
            continue
        connection.execute(
            f"UPDATE {table} SET payload_json = ? WHERE id = ? AND user_id = ?",
            (json.dumps(payload, ensure_ascii=False, separators=(",", ":")), row_id, user_id),
        )
        changed += 1
    return changed


def apply_mappings(
    connection: sqlite3.Connection,
    mappings: dict[str, dict[str, str]],
    assets: list[AssetRow],
) -> dict[str, int]:
    changed_projects = 0
    changed_snapshots = 0
    for mapping in mappings.values():
        if not mapping:
            continue
        changed_projects += rewrite_json_rows(connection, "canvas_projects", mapping)
        changed_snapshots += rewrite_json_rows(connection, "canvas_snapshots", mapping)

        for duplicate_id, canonical_id in mapping.items():
            links = connection.execute(
                "SELECT id, project_id FROM project_asset_links WHERE asset_id = ?", (duplicate_id,)
            ).fetchall()
            for link_id, project_id in links:
                exists = connection.execute(
                    "SELECT 1 FROM project_asset_links WHERE project_id = ? AND asset_id = ? LIMIT 1",
                    (project_id, canonical_id),
                ).fetchone()
                if exists:
                    connection.execute("DELETE FROM project_asset_links WHERE id = ?", (link_id,))
                else:
                    connection.execute(
                        "UPDATE project_asset_links SET asset_id = ? WHERE id = ?", (canonical_id, link_id)
                    )
            connection.execute(
                "UPDATE project_asset_candidates SET resolved_asset_id = ? WHERE resolved_asset_id = ?",
                (canonical_id, duplicate_id),
            )

    archived_ids = [duplicate_id for mapping in mappings.values() for duplicate_id in mapping]
    if archived_ids:
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        connection.executemany(
            "UPDATE assets SET status = 'archived', updated_at = ? WHERE id = ?",
            ((now, asset_id) for asset_id in archived_ids),
        )

    return {
        "projects_rewritten": changed_projects,
        "snapshots_rewritten": changed_snapshots,
        "assets_archived": len(archived_ids),
    }


def active_content_duplicates(connection: sqlite3.Connection, resources_root: Path) -> int:
    assets = load_assets(connection)
    groups: collections.Counter[tuple[str, str, str]] = collections.Counter()
    for asset in assets:
        path = resources_root / asset.object_key
        if path.is_file():
            groups[(asset.user_id, asset.kind, file_sha256(path))] += 1
    return sum(1 for count in groups.values() if count > 1)


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).resolve()
    resources_root = Path(args.resources).resolve()
    connection = connect_readonly(str(db_path)) if not args.apply else sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        if args.apply:
            backup_path = args.backup or f"{db_path}.pre-content-dedupe-{dt.datetime.now():%Y%m%d-%H%M%S}"
            backup_database(connection, backup_path)
            print(f"backup: {backup_path}")

        assets = load_assets(connection)
        reference_counts = load_reference_counts(connection)
        version_counts = {
            row["asset_id"]: row["count"]
            for row in connection.execute("SELECT asset_id, COUNT(*) AS count FROM asset_versions GROUP BY asset_id")
        }
        mappings, duplicate_groups, missing = build_mappings(
            assets, resources_root, reference_counts, version_counts
        )
        duplicate_count = sum(len(mapping) for mapping in mappings.values())
        print(f"active assets: {len(assets)}")
        print(f"missing resource files: {len(missing)}")
        print(f"content duplicate groups: {len(duplicate_groups)}")
        print(f"redundant assets: {duplicate_count}")
        for label, rows in duplicate_groups:
            keep = [row for row in rows if row.id not in mappings.get(row.user_id, {})]
            kept = keep[0] if keep else rows[0]
            print(f"  {label}: keep={kept.id} archive={len(rows) - 1}")

        if not args.apply:
            print("dry run only; pass --apply to archive duplicates and rewrite references")
            return 0
        if not duplicate_count:
            print("nothing to apply")
            return 0

        with connection:
            result = apply_mappings(connection, mappings, assets)
            remaining = active_content_duplicates(connection, resources_root)
            if remaining:
                raise RuntimeError(f"content dedupe incomplete: {remaining} duplicate groups remain")
        print(
            "applied: "
            f"assets_archived={result['assets_archived']} "
            f"projects_rewritten={result['projects_rewritten']} "
            f"snapshots_rewritten={result['snapshots_rewritten']}"
        )
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
