from __future__ import annotations

import contextlib
import importlib.util
import io
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("compact-agent-op-results.py")


def load_module():
    spec = importlib.util.spec_from_file_location("compact_agent_op_results_under_test", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CompactAgentOpResultsTest(unittest.TestCase):
    def test_apply_compresses_only_large_beneficial_receipts(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as temp:
            database = Path(temp) / "canvas.db"
            with contextlib.closing(sqlite3.connect(database)) as con:
                con.execute(
                    "CREATE TABLE agent_op_records (user_id TEXT, op_id TEXT, result_json TEXT, result_encoding TEXT, PRIMARY KEY(user_id,op_id))"
                )
                large = '{"items":"' + ("large-receipt-" * 4096) + '"}'
                con.execute("INSERT INTO agent_op_records VALUES (?,?,?,?)", ("u1", "large", large, ""))
                con.execute("INSERT INTO agent_op_records VALUES (?,?,?,?)", ("u1", "small", '{"ok":true}', ""))
                con.commit()

            output = io.StringIO()
            argv = [str(SCRIPT), "--database", str(database), "--apply"]
            with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(output):
                self.assertEqual(module.main(), 0)

            with contextlib.closing(sqlite3.connect(database)) as con:
                large_value, large_encoding = con.execute(
                    "SELECT result_json, result_encoding FROM agent_op_records WHERE op_id='large'"
                ).fetchone()
                small_value, small_encoding = con.execute(
                    "SELECT result_json, result_encoding FROM agent_op_records WHERE op_id='small'"
                ).fetchone()
            self.assertTrue(large_value.startswith(module.PREFIX))
            self.assertEqual(large_encoding, module.ENCODING)
            self.assertEqual(small_value, '{"ok":true}')
            self.assertEqual(small_encoding, "")
            self.assertIn("rows=1", output.getvalue())


if __name__ == "__main__":
    unittest.main()
