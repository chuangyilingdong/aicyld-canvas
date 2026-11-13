from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("archive-missing-canvas-assets.py")


def load_module():
    spec = importlib.util.spec_from_file_location("archive_missing_canvas_assets_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ArchiveMissingCanvasAssetsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "resources"
        self.root.mkdir()
        self.db = Path(self.temp.name) / "canvas.db"
        connection = sqlite3.connect(self.db)
        connection.executescript(
            """
            CREATE TABLE assets (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE resources (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                provider TEXT NOT NULL,
                status TEXT NOT NULL,
                object_key TEXT NOT NULL,
                size INTEGER NOT NULL
            );
            """
        )
        connection.commit()
        connection.close()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def add_resource(self, resource_id: str, object_key: str) -> Path:
        path = self.root / object_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"same")
        connection = sqlite3.connect(self.db)
        connection.execute(
            "INSERT INTO resources VALUES (?, 'user-1', 'image', 'local', 'ready', ?, 4)",
            (resource_id, object_key),
        )
        connection.commit()
        connection.close()
        return path

    def add_asset(self, asset_id: str, resource_id: str) -> None:
        payload = json.dumps({"data": {"storageKey": f"resource:{resource_id}"}})
        connection = sqlite3.connect(self.db)
        connection.execute(
            "INSERT INTO assets VALUES (?, 'user-1', 'image', ?, 'confirmed', ?, 'old')",
            (asset_id, asset_id, payload),
        )
        connection.commit()
        connection.close()

    def status(self, asset_id: str) -> str:
        connection = sqlite3.connect(self.db)
        try:
            return str(connection.execute("SELECT status FROM assets WHERE id = ?", (asset_id,)).fetchone()[0])
        finally:
            connection.close()

    def test_finds_and_archives_missing_file_and_orphan_only(self) -> None:
        module = load_module()
        healthy_path = self.add_resource("resource-healthy", "users/user-1/image/healthy.png")
        missing_path = self.add_resource("resource-missing-file", "users/user-1/image/missing.png")
        missing_path.unlink()
        self.add_asset("asset-healthy", "resource-healthy")
        self.add_asset("asset-missing-file", "resource-missing-file")
        self.add_asset("asset-orphan", "resource-orphan")

        broken = module.find_broken_assets(str(self.db), str(self.root))

        self.assertEqual(
            [(item.asset_id, item.reason) for item in broken],
            [("asset-missing-file", "file_missing"), ("asset-orphan", "resource_missing")],
        )

        backup = Path(self.temp.name) / "backup.db"
        archived = module.archive_assets(str(self.db), [item.asset_id for item in broken], str(backup))

        self.assertEqual(archived, 2)
        self.assertTrue(backup.is_file())
        self.assertEqual(self.status("asset-healthy"), "confirmed")
        self.assertEqual(self.status("asset-missing-file"), "archived")
        self.assertEqual(self.status("asset-orphan"), "archived")
        self.assertTrue(healthy_path.is_file())
        self.assertEqual(module.find_broken_assets(str(self.db), str(self.root)), [])

    def test_dry_run_finder_does_not_modify_assets(self) -> None:
        module = load_module()
        missing_path = self.add_resource("resource-missing-file", "users/user-1/image/missing.png")
        missing_path.unlink()
        self.add_asset("asset-missing-file", "resource-missing-file")

        broken = module.find_broken_assets(str(self.db), str(self.root))

        self.assertEqual(len(broken), 1)
        self.assertEqual(self.status("asset-missing-file"), "confirmed")


if __name__ == "__main__":
    unittest.main()
