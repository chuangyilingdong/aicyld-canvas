#!/usr/bin/env python3
"""Copy and audit the AICYLD Canvas SQLite database without modifying the source."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path


def connect_read_only(path: str) -> sqlite3.Connection:
    uri = Path(path).resolve().as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


def table_names(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [str(row[0]) for row in rows]


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def schema_version(conn: sqlite3.Connection, table: str) -> int | None:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    if not exists:
        return None
    row = conn.execute(f"SELECT COALESCE(MAX(version), 0) FROM {quote_identifier(table)}").fetchone()
    return int(row[0]) if row else 0


def snapshot(path: str) -> dict:
    conn = connect_read_only(path)
    try:
        tables = table_names(conn)
        counts = {
            table: int(conn.execute(f"SELECT COUNT(*) FROM {quote_identifier(table)}").fetchone()[0])
            for table in tables
        }
        integrity_rows = conn.execute("PRAGMA integrity_check").fetchall()
        foreign_key_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
        return {
            "path": str(Path(path).resolve()),
            "tables": counts,
            "local_schema_version": schema_version(conn, "local_schema_migrations"),
            "aicyld_overlay_version": schema_version(conn, "aicyld_schema_migrations"),
            "integrity_check": [str(row[0]) for row in integrity_rows],
            "foreign_key_violations": [list(row) for row in foreign_key_rows],
        }
    finally:
        conn.close()


def copy_database(source: str, destination: str) -> None:
    source_path = Path(source).resolve()
    destination_path = Path(destination).resolve()
    if source_path == destination_path:
        raise ValueError("source and destination databases must differ")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if destination_path.exists():
        destination_path.unlink()
    source_conn = connect_read_only(str(source_path))
    destination_conn = sqlite3.connect(destination_path)
    try:
        source_conn.backup(destination_conn)
    finally:
        destination_conn.close()
        source_conn.close()


def compare(before_path: str, after_path: str) -> int:
    before = json.loads(Path(before_path).read_text(encoding="utf-8"))
    after = json.loads(Path(after_path).read_text(encoding="utf-8"))
    before_tables = before["tables"]
    after_tables = after["tables"]
    ledger_tables = {"local_schema_migrations", "aicyld_schema_migrations"}
    ledger_changes = [
        {"table": table, "before": before_tables[table], "after": after_tables[table]}
        for table in ledger_tables
        if table in before_tables and table in after_tables and after_tables[table] != before_tables[table]
    ]
    changed = [
        {"table": table, "before": count, "after": after_tables[table]}
        for table, count in before_tables.items()
        if table not in ledger_tables and table in after_tables and after_tables[table] != count
    ]
    missing = sorted(set(before_tables) - set(after_tables))
    added = sorted(set(after_tables) - set(before_tables))
    report = {
        "ok": not changed and not missing and after["integrity_check"] == ["ok"] and not after["foreign_key_violations"],
        "changed_rows": changed,
        "schema_ledger_changes": ledger_changes,
        "missing_tables": missing,
        "added_tables": added,
        "before_versions": {
            "local": before["local_schema_version"],
            "aicyld_overlay": before["aicyld_overlay_version"],
        },
        "after_versions": {
            "local": after["local_schema_version"],
            "aicyld_overlay": after["aicyld_overlay_version"],
        },
        "integrity_check": after["integrity_check"],
        "foreign_key_violations": after["foreign_key_violations"],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)

    copy_parser = subcommands.add_parser("copy", help="create a consistent SQLite backup")
    copy_parser.add_argument("--source", required=True)
    copy_parser.add_argument("--destination", required=True)

    snapshot_parser = subcommands.add_parser("snapshot", help="record table counts and integrity")
    snapshot_parser.add_argument("--db", required=True)
    snapshot_parser.add_argument("--out", required=True)

    compare_parser = subcommands.add_parser("compare", help="compare migration snapshots")
    compare_parser.add_argument("--before", required=True)
    compare_parser.add_argument("--after", required=True)

    args = parser.parse_args()
    if args.command == "copy":
        copy_database(args.source, args.destination)
        return 0
    if args.command == "snapshot":
        report = snapshot(args.db)
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["integrity_check"] == ["ok"] and not report["foreign_key_violations"] else 1
    return compare(args.before, args.after)


if __name__ == "__main__":
    sys.exit(main())
