from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("prune-oss-backups.py")


def load_module():
    spec = importlib.util.spec_from_file_location("prune_oss_backups_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PruneOSSBackupsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_module()

    def test_shared_objects_are_kept_while_any_live_manifest_references_them(self) -> None:
        candidate = {
            "objects": [
                {"key": "canvas/backups/daily/old/manifest.json", "shared": False},
                {"key": "canvas/backups/shared/resources/objects/a", "shared": True},
                {"key": "canvas/backups/shared/resources/objects/b", "shared": True},
            ]
        }
        live = {
            "objects": [
                {"key": "canvas/backups/shared/resources/objects/b", "shared": True},
                {"key": "canvas/backups/shared/resources/objects/c", "shared": True},
            ]
        }

        self.assertEqual(
            self.module.deletable_shared_keys([candidate], [live]),
            {"canvas/backups/shared/resources/objects/a"},
        )
        self.assertEqual(
            self.module.manifest_key_set(candidate, shared=False),
            {"canvas/backups/daily/old/manifest.json"},
        )


if __name__ == "__main__":
    unittest.main()
