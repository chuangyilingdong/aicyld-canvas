from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("canvas-asset-integrity-audit.py")


def load_module():
    spec = importlib.util.spec_from_file_location("canvas_asset_integrity_audit_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class CanvasAssetIntegrityAuditTest(unittest.TestCase):
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
                payload_json TEXT NOT NULL
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

    def add_resource(self, resource_id: str, kind: str, object_key: str, content: bytes = b"same") -> None:
        path = self.root / object_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        connection = sqlite3.connect(self.db)
        connection.execute(
            "INSERT INTO resources VALUES (?, ?, ?, 'local', 'ready', ?, ?)",
            (resource_id, "user-1", kind, object_key, len(content)),
        )
        connection.commit()
        connection.close()

    def add_asset(self, asset_id: str, resource_id: str, kind: str = "image", status: str = "confirmed") -> None:
        payload = json.dumps({"data": {"storageKey": f"resource:{resource_id}"}})
        connection = sqlite3.connect(self.db)
        connection.execute(
            "INSERT INTO assets VALUES (?, 'user-1', ?, ?, ?, ?)",
            (asset_id, kind, asset_id, status, payload),
        )
        connection.commit()
        connection.close()

    def test_clean_fixture_passes(self) -> None:
        self.add_resource("resource-1", "image", "users/user-1/image/one.png")
        self.add_asset("asset-1", "resource-1")

        report = load_module().audit(str(self.db), str(self.root))

        self.assertTrue(report["ok"])
        self.assertEqual(report["duplicateResourceGroups"], 0)
        self.assertEqual(report["contentDuplicateGroups"], 0)
        self.assertEqual(report["missingResourceFiles"], 0)
        self.assertEqual(report["orphanAssets"], 0)

    def test_detects_same_resource_and_same_content_duplicates(self) -> None:
        self.add_resource("resource-1", "image", "users/user-1/image/one.png", b"same")
        self.add_resource("resource-2", "image", "users/user-1/image/two.png", b"same")
        self.add_asset("asset-1", "resource-1")
        self.add_asset("asset-2", "resource-1")
        self.add_asset("asset-3", "resource-2")

        report = load_module().audit(str(self.db), str(self.root))

        self.assertFalse(report["duplicateOk"])
        self.assertEqual(report["duplicateResourceGroups"], 1)
        self.assertEqual(report["duplicateResourceAssets"], 2)
        self.assertEqual(report["contentDuplicateGroups"], 1)
        self.assertEqual(report["contentDuplicateAssets"], 3)

    def test_detects_missing_files_and_orphan_assets(self) -> None:
        self.add_resource("resource-1", "video", "users/user-1/video/missing.mp4")
        (self.root / "users/user-1/video/missing.mp4").unlink()
        self.add_asset("asset-1", "resource-1", kind="video")
        self.add_asset("asset-2", "resource-missing", kind="image")

        report = load_module().audit(str(self.db), str(self.root))

        self.assertTrue(report["duplicateOk"])
        self.assertFalse(report["integrityOk"])
        self.assertEqual(report["missingResourceFiles"], 1)
        self.assertEqual(report["orphanAssets"], 1)


if __name__ == "__main__":
    unittest.main()
