#!/usr/bin/env python3
"""Compress large AICYLD Canvas agent operation receipts in place."""

from __future__ import annotations

import argparse
import base64
import gzip
import sqlite3
from pathlib import Path


PREFIX = "gzip+b64:"
ENCODING = "gzip+base64"
MIN_BYTES = 32 * 1024


def encode_result(raw: bytes) -> tuple[str, str] | None:
    compressed = PREFIX + base64.b64encode(gzip.compress(raw, compresslevel=6)).decode("ascii")
    if len(compressed) >= len(raw) * 3 // 4:
        return None
    return compressed, ENCODING


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", default="/srv/aicyld/canvas/data/open_ai_canvas.db")
    parser.add_argument("--min-bytes", type=int, default=MIN_BYTES)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.min_bytes < 1 or args.batch_size < 1:
        raise SystemExit("--min-bytes 和 --batch-size 必须大于 0")

    path = Path(args.database)
    if not path.is_file():
        raise SystemExit(f"数据库不存在: {path}")
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    con.execute("PRAGMA busy_timeout=30000")
    writer = sqlite3.connect(path, timeout=30) if args.apply else None
    if writer is not None:
        writer.execute("PRAGMA busy_timeout=30000")
    columns = {row[1] for row in con.execute("PRAGMA table_info(agent_op_records)")}
    if "result_encoding" not in columns:
        con.close()
        raise SystemExit("agent_op_records.result_encoding 不存在，请先部署 schema v32")

    selected = con.execute(
        "SELECT user_id, op_id, result_json FROM agent_op_records "
        "WHERE length(result_json) >= ? AND COALESCE(result_encoding, '') = '' "
        "AND result_json NOT LIKE 'gzip+b64:%' ORDER BY length(result_json) DESC",
        (args.min_bytes,),
    )
    candidates = 0
    raw_bytes = 0
    encoded_bytes = 0
    updates: list[tuple[str, str, str, str]] = []
    while True:
        rows = selected.fetchmany(args.batch_size)
        if not rows:
            break
        for user_id, op_id, value in rows:
            raw = (value or "").encode("utf-8")
            encoded = encode_result(raw)
            if encoded is None:
                continue
            value, encoding = encoded
            candidates += 1
            raw_bytes += len(raw)
            encoded_bytes += len(value)
            updates.append((value, encoding, user_id, op_id))
            if writer is not None and len(updates) >= args.batch_size:
                writer.executemany(
                    "UPDATE agent_op_records SET result_json = ?, result_encoding = ? "
                    "WHERE user_id = ? AND op_id = ?",
                    updates,
                )
                writer.commit()
                updates.clear()

    if writer is not None and updates:
        writer.executemany(
            "UPDATE agent_op_records SET result_json = ?, result_encoding = ? "
            "WHERE user_id = ? AND op_id = ?",
            updates,
        )
        writer.commit()
    if writer is not None:
        writer.execute("PRAGMA optimize")
    print(
        f"mode={'apply' if args.apply else 'dry-run'} rows={candidates} "
        f"raw_bytes={raw_bytes} encoded_bytes={encoded_bytes} "
        f"saved_bytes={raw_bytes - encoded_bytes}"
    )
    stats = writer if writer is not None else con
    page_count = stats.execute("PRAGMA page_count").fetchone()[0]
    freelist = stats.execute("PRAGMA freelist_count").fetchone()[0]
    print(f"page_count={page_count} freelist={freelist}")
    con.close()
    if writer is not None:
        writer.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
