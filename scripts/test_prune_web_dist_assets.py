from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("prune-web-dist-assets.py")


def load_module():
    spec = importlib.util.spec_from_file_location("prune_web_dist_assets_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PruneWebDistAssetsTest(unittest.TestCase):
    def test_apply_keeps_current_and_previous_manifest_files(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "canvas"
            current = root / "web-dist"
            previous = root / ".web-dist.prev-old"
            old = root / "web-dist.prev-older"
            for directory in (current, previous, old):
                (directory / "static").mkdir(parents=True)
            manifests = {
                current: ["index.html", "static/current.js", "version.json"],
                previous: ["static/previous.js", "version.json"],
                old: ["static/old-only.js", "version.json"],
            }
            for directory, files in manifests.items():
                for relative in files:
                    if relative == "version.json":
                        continue
                    path = directory / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(relative, encoding="utf-8")
                (directory / "version.json").write_text(json.dumps({"files": files}), encoding="utf-8")
            (current / "static" / "previous.js").write_text("retain for rollback", encoding="utf-8")
            (current / "static" / "unreferenced.js").write_text("remove", encoding="utf-8")
            (current / "root-public.png").write_text("keep public root file", encoding="utf-8")
            os.utime(old, (100, 100))
            os.utime(previous, (200, 200))

            argv = [
                str(SCRIPT),
                "--canvas-root",
                str(root),
                "--keep-previous",
                "1",
                "--apply",
            ]
            output = io.StringIO()
            with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(output):
                self.assertEqual(module.main(), 0)

            self.assertTrue((current / "index.html").is_file())
            self.assertTrue((current / "static" / "current.js").is_file())
            self.assertTrue((current / "static" / "previous.js").is_file())
            self.assertFalse((current / "static" / "unreferenced.js").exists())
            self.assertTrue((current / "root-public.png").is_file())
            self.assertTrue((previous / "static" / "previous.js").is_file())
            self.assertTrue((old / "static" / "old-only.js").is_file())
            self.assertIn("deleted_files=1", output.getvalue())


if __name__ == "__main__":
    unittest.main()
