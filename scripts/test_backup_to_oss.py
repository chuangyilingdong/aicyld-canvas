from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("backup-to-oss.py")


def load_module():
    spec = importlib.util.spec_from_file_location("backup_to_oss_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackupToOSSTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_dry_run_excludes_local_backup_history(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
            root = Path(temp) / "canvas"
            data = root / "data"
            backups = root / "backups" / "old-release"
            data.mkdir(parents=True)
            backups.mkdir(parents=True)
            (backups / "node_modules-file.js").write_text("must not upload", encoding="utf-8")
            with sqlite3.connect(data / "open_ai_canvas.db") as connection:
                connection.execute("CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)")
                connection.execute("INSERT INTO sample (value) VALUES ('ok')")

            env = Path(temp) / "canvas.env"
            env.write_text(
                "\n".join(
                    (
                        "CANVAS_OSS_ENDPOINT=https://oss.example.test",
                        "CANVAS_OSS_BUCKET=test-bucket",
                        "CANVAS_OSS_ACCESS_KEY=test-access",
                        "CANVAS_OSS_SECRET_KEY=test-secret",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            output = io.StringIO()
            argv = [
                str(SCRIPT),
                "--canvas-root",
                str(root),
                "--env-file",
                str(env),
                "--work-dir",
                str(Path(temp) / "work"),
                "--run-id",
                "unit-test",
            ]
            with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(output):
                self.assertEqual(self.module.main(), 0)

            report = output.getvalue()
            self.assertIn("objects=1", report)
            self.assertIn("rollback archives=0", report)
            self.assertNotIn("old-release", report)

    def test_latest_web_rollbacks_keeps_newest_directories_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old = root / ".web-dist.prev-old"
            new = root / ".web-dist.prev-new"
            ignored = root / "web-dist"
            for path in (old, new, ignored):
                path.mkdir()
            os.utime(old, (100, 100))
            os.utime(new, (200, 200))
            os.utime(ignored, (300, 300))

            selected = self.module.latest_web_rollbacks(root, limit=1)
            self.assertEqual(selected, [new])

    def test_backup_budget_rejects_unbounded_object_growth(self) -> None:
        with self.assertRaisesRegex(SystemExit, "备份对象数"):
            self.module.validate_backup_budget(5001, 1024, 5000, 8 * 1024**3)


if __name__ == "__main__":
    unittest.main()
