#!/usr/bin/env python3
"""Create consistent AICYLD Canvas backups and upload them to Aliyun OSS.

The script intentionally backs up live state to a separate OSS prefix.  It does
not modify the running media index or the application database.

Usage:
  backup-to-oss.py --canvas-root /srv/aicyld/canvas \
    --env-file /srv/aicyld/canvas/canvas.env --apply

Without --apply it only stages and prints the upload plan.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import hashlib
import hmac
import http.client
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
from pathlib import Path
from typing import Iterable


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[key.strip()] = value
    return values


class OSSClient:
    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str, prefix: str):
        endpoint = endpoint.strip().rstrip("/")
        if "://" not in endpoint:
            endpoint = "https://" + endpoint
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("CANVAS_OSS_ENDPOINT 必须是 HTTPS endpoint")
        self.endpoint_host = parsed.hostname
        self.bucket = bucket.strip()
        self.access_key = access_key.strip()
        self.secret_key = secret_key.strip()
        self.host = f"{self.bucket}.{self.endpoint_host}"
        self.prefix = prefix.strip("/")
        if not self.bucket or not self.access_key or not self.secret_key:
            raise ValueError("OSS 配置不完整")

    @staticmethod
    def _path(key: str) -> str:
        return "/" + "/".join(urllib.parse.quote(part, safe="") for part in key.split("/"))

    def _auth(self, method: str, content_type: str, date: str, key: str) -> str:
        resource = f"/{self.bucket}/{key}"
        string_to_sign = f"{method}\n\n{content_type}\n{date}\n{resource}"
        digest = hmac.new(self.secret_key.encode(), string_to_sign.encode(), hashlib.sha1).digest()
        return f"OSS {self.access_key}:{base64.b64encode(digest).decode()}"

    def _request(self, method: str, key: str, *, body: Path | None = None, content_type: str = "") -> tuple[int, dict[str, str], bytes]:
        conn = http.client.HTTPSConnection(self.host, timeout=1800)
        date = dt.datetime.now(dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        headers = {
            "Host": self.host,
            "Date": date,
            "Authorization": self._auth(method, content_type, date, key),
        }
        if content_type:
            headers["Content-Type"] = content_type
        if body is not None:
            size = body.stat().st_size
            headers["Content-Length"] = str(size)
            conn.putrequest(method, self._path(key), skip_host=True, skip_accept_encoding=True)
            for name, value in headers.items():
                conn.putheader(name, value)
            conn.endheaders()
            with body.open("rb") as stream:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    conn.send(chunk)
        else:
            conn.putrequest(method, self._path(key), skip_host=True, skip_accept_encoding=True)
            for name, value in headers.items():
                conn.putheader(name, value)
            conn.endheaders()
        response = conn.getresponse()
        result_body = response.read(1024 * 1024)
        response_headers = {name.lower(): value for name, value in response.getheaders()}
        conn.close()
        return response.status, response_headers, result_body

    def head(self, key: str) -> tuple[bool, int]:
        for attempt in range(3):
            try:
                status, headers, _ = self._request("HEAD", key)
                if status == 200:
                    return True, int(headers.get("content-length", "0"))
                if status == 404:
                    return False, 0
                if status in (500, 502, 503, 504):
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"OSS HEAD {key} 返回 {status}")
            except (OSError, http.client.HTTPException) as exc:
                if attempt == 2:
                    raise RuntimeError(f"OSS HEAD {key} 失败: {exc}") from exc
                time.sleep(2 ** attempt)
        raise RuntimeError(f"OSS HEAD {key} 重试耗尽")

    def delete(self, key: str) -> None:
        status, _, body = self._request("DELETE", key)
        if status in (200, 202, 204, 404):
            return
        detail = body.decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"OSS DELETE {key} 返回 {status}: {detail}")

    def put(self, key: str, source: Path, content_type: str = "application/octet-stream") -> None:
        for attempt in range(3):
            try:
                status, _, body = self._request("PUT", key, body=source, content_type=content_type)
                if status in (200, 201, 204):
                    return
                if status in (500, 502, 503, 504):
                    time.sleep(2 ** attempt)
                    continue
                detail = body.decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"OSS PUT {key} 返回 {status}: {detail}")
            except (OSError, http.client.HTTPException) as exc:
                if attempt == 2:
                    raise RuntimeError(f"OSS PUT {key} 失败: {exc}") from exc
                time.sleep(2 ** attempt)
        raise RuntimeError(f"OSS PUT {key} 重试耗尽")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(4 * 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def consistent_sqlite_backup(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True, timeout=30)
    dst = sqlite3.connect(str(target), timeout=30)
    try:
        src.execute("PRAGMA busy_timeout=30000")
        src.backup(dst)
        dst.execute("PRAGMA integrity_check")
        result = dst.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError(f"SQLite 备份完整性检查失败: {source}: {result}")
    finally:
        dst.close()
        src.close()


def add_file(items: list[tuple[Path, str]], source: Path, remote_relative: str, required: bool = True) -> None:
    if source.is_file():
        items.append((source, remote_relative))
    elif required:
        raise FileNotFoundError(source)


SENSITIVE_BACKUP_PREFIXES = (
    "canvas.env",
    "platform-channels.json",
    "agent_host_token",
    "agent_owner_token",
    "local-model-config.json",
    ".settings-key",
)


def is_sensitive_backup_name(name: str) -> bool:
    lowered = name.lower()
    return any(lowered.startswith(prefix) for prefix in SENSITIVE_BACKUP_PREFIXES)


def add_tree(items: list[tuple[Path, str]], source: Path, remote_relative: str, required: bool = False, skip_sensitive: bool = False) -> None:
    if not source.exists():
        if required:
            raise FileNotFoundError(source)
        return
    for path in sorted(source.rglob("*")):
        if path.is_file() and (not skip_sensitive or not is_sensitive_backup_name(path.name)):
            items.append((path, f"{remote_relative}/{path.relative_to(source).as_posix()}"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canvas-root", default="/srv/aicyld/canvas")
    parser.add_argument("--env-file", default="/srv/aicyld/canvas/canvas.env")
    parser.add_argument("--work-dir", default="/var/tmp")
    parser.add_argument("--apply", action="store_true", help="实际上传；缺省只生成计划")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--run-id", default="", help="复用已有上传前缀；用于中断后续传")
    args = parser.parse_args()

    root = Path(args.canvas_root).resolve()
    env_path = Path(args.env_file).resolve()
    if not root.is_dir() or not env_path.is_file():
        raise SystemExit("Canvas 根目录或环境文件不存在")

    env = load_env(env_path)
    required = ("CANVAS_OSS_ENDPOINT", "CANVAS_OSS_BUCKET", "CANVAS_OSS_ACCESS_KEY", "CANVAS_OSS_SECRET_KEY")
    missing = [key for key in required if not env.get(key, "").strip()]
    if missing:
        raise SystemExit("OSS 配置缺失: " + ", ".join(missing))

    run_id = args.run_id.strip() or dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    work = Path(args.work_dir) / f"aicyld-canvas-oss-{run_id}"
    work.mkdir(parents=True, exist_ok=False)
    items: list[tuple[Path, str]] = []

    db_source = root / "data" / "open_ai_canvas.db"
    db_target = work / "db" / "open_ai_canvas.db"
    consistent_sqlite_backup(db_source, db_target)
    items.append((db_target, "db/open_ai_canvas.db"))

    sessions_root = root / "data" / "sessions"
    session_count = 0
    if sessions_root.is_dir():
        for source in sorted(sessions_root.rglob("*")):
            if source.is_file() and source.suffix.lower() in (".sqlite", ".sqlite3", ".db"):
                relative = source.relative_to(sessions_root)
                target = work / "sessions" / relative
                consistent_sqlite_backup(source, target)
                items.append((target, f"sessions/{relative.as_posix()}"))
                session_count += 1

    for relative in (
        "VERSION",
        "RELEASE.json",
        "data/oss-index.json",
    ):
        add_file(items, root / relative, f"meta/{relative.replace('/', '_')}", required=False)

    add_tree(items, root / "data" / "plugin-packages", "data/plugin-packages")
    add_tree(items, root / "data" / "skill-packages", "data/skill-packages")

    resources_root = root / "data" / "resources"
    add_tree(items, resources_root, "data/resources", required=False)

    for source in sorted((root / "backups").iterdir()):
        if source.is_file() and not is_sensitive_backup_name(source.name):
            items.append((source, f"backups/{source.name}"))
        elif source.is_dir():
            add_tree(items, source, f"backups/{source.name}", required=True, skip_sensitive=True)

    bin_root = root / "bin"
    for source in sorted(bin_root.glob("infinite-canvas-backend*")):
        if source.is_file():
            items.append((source, f"bin/{source.name}"))

    agent_runtime = work / "agent-host-runtime.tar.zst"
    if (bin_root / "agent-host").is_dir():
        subprocess.run(["tar", "--zstd", "-cf", str(agent_runtime), "-C", str(bin_root), "agent-host"], check=True)
        items.append((agent_runtime, "bin/agent-host-runtime.tar.zst"))

    web_dist = root / "web-dist"
    web_archive = work / "web-dist-current.tar.gz"
    if web_dist.is_dir():
        subprocess.run(["tar", "-czf", str(web_archive), "-C", str(root), "web-dist"], check=True)
        items.append((web_archive, "release/web-dist-current.tar.gz"))

    rollback_names = (
        ".web-dist.failed-aicyld4-20261103-160544",
        ".web-dist.prev-aicyld4-20261103-160709",
        ".web-dist.prev-aicyld-v213-1-20261103-132106",
    )
    rollback_archive = work / "web-dist-rollback-extra.tar.zst"
    rollback_paths = [root / name for name in rollback_names if (root / name).is_dir()]
    if rollback_paths:
        subprocess.run(
            ["tar", "--zstd", "-cf", str(rollback_archive), "-C", str(root), *[p.name for p in rollback_paths]],
            check=True,
        )
        items.append((rollback_archive, "release/web-dist-rollback-extra.tar.zst"))

    base_prefix = "/".join(part for part in (env.get("CANVAS_OSS_PATH_PREFIX", "canvas").strip("/"), "backups", "daily", run_id) if part)
    manifest: dict[str, object] = {
        "format": "aicyld-canvas-oss-backup-v1",
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "hostname": os.uname().nodename,
        "canvasVersion": (root / "VERSION").read_text(encoding="utf-8").strip() if (root / "VERSION").is_file() else "",
        "databaseSnapshot": "db/open_ai_canvas.db",
        "sessionSnapshots": session_count,
        "objects": [],
        "excluded": ["canvas.env and secret backups", "data/workspace token/config files", "src/.git", "src/node_modules", "application logs"],
    }

    total_bytes = sum(path.stat().st_size for path, _ in items)
    print(f"backup staging: {work}")
    print(f"objects={len(items)} bytes={total_bytes} sessions={session_count}")
    print(f"oss prefix: {base_prefix}/")

    if not args.apply:
        for path, relative in items[:12]:
            print(f"PLAN {path} -> {base_prefix}/{relative}")
        if len(items) > 12:
            print(f"PLAN ... {len(items) - 12} more objects")
        print("dry-run: add --apply to upload")
        return 0

    client = OSSClient(
        env["CANVAS_OSS_ENDPOINT"],
        env["CANVAS_OSS_BUCKET"],
        env["CANVAS_OSS_ACCESS_KEY"],
        env["CANVAS_OSS_SECRET_KEY"],
        env.get("CANVAS_OSS_PATH_PREFIX", "canvas"),
    )

    results: dict[str, dict[str, object]] = {}
    errors: list[str] = []

    def upload_one(item: tuple[Path, str]) -> tuple[str, dict[str, object]]:
        source, relative = item
        key = f"{base_prefix}/{relative}"
        size = source.stat().st_size
        exists, remote_size = client.head(key)
        if exists and remote_size == size:
            return relative, {"key": key, "size": size, "sha256": sha256_file(source), "status": "already-present"}
        client.put(key, source)
        exists, remote_size = client.head(key)
        if not exists or remote_size != size:
            raise RuntimeError(f"上传校验失败: {key}, local={size}, remote={remote_size}")
        return relative, {"key": key, "size": size, "sha256": sha256_file(source), "status": "uploaded"}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(upload_one, item): item for item in items}
        for future in concurrent.futures.as_completed(futures):
            source, relative = futures[future]
            try:
                name, record = future.result()
                results[name] = record
                print(f"OK {record['status']} {record['key']} ({record['size']} bytes)")
            except Exception as exc:
                errors.append(f"{source}: {exc}")
                print(f"ERROR {source}: {exc}", file=sys.stderr)

    if errors:
        raise SystemExit("备份上传失败，未清理本地文件:\n" + "\n".join(errors))

    manifest["objects"] = [results[relative] for _, relative in items]
    manifest_path = work / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest_key = f"{base_prefix}/manifest.json"
    client.put(manifest_key, manifest_path)
    exists, remote_size = client.head(manifest_key)
    if not exists or remote_size != manifest_path.stat().st_size:
        raise SystemExit("manifest 上传校验失败")
    manifest_sha = sha256_file(manifest_path)
    checksum_path = work / "manifest.json.sha256"
    checksum_path.write_text(f"{manifest_sha}  manifest.json\n", encoding="utf-8")
    checksum_key = f"{base_prefix}/manifest.json.sha256"
    client.put(checksum_key, checksum_path)
    manifest_store = root / "backups" / "oss-manifests"
    manifest_store.mkdir(parents=True, exist_ok=True)
    shutil.copy2(manifest_path, manifest_store / f"{run_id}.json")
    (manifest_store / "LATEST").write_text(run_id + "\n", encoding="utf-8")
    print(f"MANIFEST oss://{env['CANVAS_OSS_BUCKET']}/{manifest_key}")
    print(f"SHA256 {manifest_sha}")
    print(f"backup complete: objects={len(items)} bytes={total_bytes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())






