#!/usr/bin/env python3
"""Reclassify provably rejected or unsent historical canvas tasks.

This repair is intentionally evidence-driven. A task is changed only when its
route attempts, sanitized diagnostics, or API response prove that no upstream
job exists. Ambiguous records remain in submission_unknown.

The script is dry-run by default:

  python3 scripts/repair-historical-submission-unknown.py --db /path/to/db

Applying changes requires both --apply and an explicit backup:

  python3 scripts/repair-historical-submission-unknown.py --db /path/to/db \
    --apply --backup /path/to/backup.db
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Repair:
    category: str
    stage: str
    message: str
    dispatch_state: str
    outcome_reason: str
    confidence: str


MESSAGES = {
    "request_not_sent": Repair(
        category="request_not_sent",
        stage="任务失败",
        message="未能连接服务，本次请求尚未提交。请检查网络或代理后重试。",
        dispatch_state="not_sent",
        outcome_reason="request_not_sent",
        confidence="dispatched=false",
    ),
    "invalid_params": Repair(
        category="invalid_params",
        stage="任务失败",
        message="模型不接受当前参数。请检查模型、尺寸、比例、分辨率、时长、格式或参考素材后重试。",
        dispatch_state="rejected_no_job",
        outcome_reason="input_rejected",
        confidence="provider rejected request before task creation",
    ),
    "provider_unavailable": Repair(
        category="provider_unavailable",
        stage="任务失败",
        message="当前模型或接口不可用。请切换可用模型或渠道后重试。",
        dispatch_state="rejected_no_job",
        outcome_reason="provider_unavailable",
        confidence="provider unavailable before task creation",
    ),
    "auth": Repair(
        category="auth",
        stage="任务失败",
        message="模型渠道凭据无效或无权访问。请检查渠道密钥后重试。",
        dispatch_state="rejected_no_job",
        outcome_reason="provider_unavailable",
        confidence="provider authentication failure before task creation",
    ),
    "moderation": Repair(
        category="moderation_reference",
        stage="任务失败",
        message="请求未通过内容安全校验。请调整提示词或参考素材后重试。",
        dispatch_state="rejected_no_job",
        outcome_reason="input_rejected",
        confidence="provider moderation rejection before task creation",
    ),
}


def parse_json(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def response_payloads(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip():
        return []
    parsed = parse_json(raw)
    if parsed:
        return [parsed]
    payloads: list[dict[str, Any]] = []
    data_lines: list[str] = []
    for line in raw.splitlines():
        value = line.strip()
        if not value:
            continue
        if value.startswith("data:"):
            value = value[5:].strip()
            if value and value != "[DONE]":
                data_lines.append(value)
    if data_lines:
        parsed = parse_json("\n".join(data_lines))
        if parsed:
            payloads.append(parsed)
    return payloads


def classify_error_code(code: Any) -> str:
    value = str(code or "").strip().lower()
    if value in {
        "1007",
        "invalid_request",
        "invalid_request_error",
        "invalid_parameter",
        "invalid_parameter_value",
        "invalid_params",
        "model_not_found",
    }:
        return "invalid_params" if value != "model_not_found" else "provider_unavailable"
    if value in {"1501", "moderation_rejected", "content_filter"}:
        return "moderation"
    if value in {"401", "403", "unauthorized", "invalid_api_key"}:
        return "auth"
    if value in {"40310", "429", "502", "503", "504", "provider_unavailable", "upstream_503"}:
        return "provider_unavailable"
    return ""


def evidence_for(task: sqlite3.Row, attempts: list[sqlite3.Row], logs: list[sqlite3.Row]) -> Repair | None:
    if task["provider_request_id"]:
        return None
    if any(str(attempt["provider_request_id"] or "").strip() for attempt in attempts):
        return None

    diagnostics = parse_json(task["failure_diagnostics"])
    requests = diagnostics.get("requests") if isinstance(diagnostics.get("requests"), list) else []
    for request in requests:
        if not isinstance(request, dict):
            continue
        if request.get("dispatched") is False or request.get("outcome") == "not_dispatched":
            return MESSAGES["request_not_sent"]

    candidate_categories: list[str] = []
    for log in logs:
        if str(log["error_code"] or "").strip().lower() == "request_not_sent":
            return MESSAGES["request_not_sent"]
        if log["status_code"] in (401, 403):
            candidate_categories.append("auth")
        elif log["status_code"] in (400, 409, 422):
            candidate_categories.append("invalid_params")
        elif log["status_code"] in (429, 502, 503, 504):
            candidate_categories.append("provider_unavailable")
        category = classify_error_code(log["error_code"])
        if category:
            candidate_categories.append(category)
        for payload in response_payloads(log["response_body"]):
            if str(payload.get("taskId") or "").strip():
                return None
            for key in ("errorCode", "code", "error_code"):
                category = classify_error_code(payload.get(key))
                if category:
                    candidate_categories.append(category)
                    break

    for request in requests:
        if not isinstance(request, dict) or request.get("dispatched") is False:
            continue
        status = int(request.get("httpStatus") or 0)
        if status in (401, 403):
            candidate_categories.append("auth")
        elif status in (400, 409, 422):
            candidate_categories.append("invalid_params")
        elif status in (429, 502, 503, 504):
            candidate_categories.append("provider_unavailable")
        category = classify_error_code(request.get("providerCode"))
        if category:
            candidate_categories.append(category)

    priority = ("auth", "moderation", "invalid_params", "provider_unavailable")
    for category in priority:
        if category in candidate_categories:
            return MESSAGES[category]
    return None


def update_diagnostics(raw: Any, repair: Repair) -> str:
    diagnostics = parse_json(raw)
    diagnostics["source"] = "historical_submission_repair"
    diagnostics["summary"] = repair.message
    diagnostics["stage"] = repair.stage
    diagnostics["repairedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    diagnostics["repairEvidence"] = repair.confidence
    return json.dumps(diagnostics, ensure_ascii=False, separators=(",", ":"))


def node_task_id(node: dict[str, Any]) -> str:
    metadata = node.get("metadata")
    if isinstance(metadata, dict):
        return str(metadata.get("taskId") or "")
    data = node.get("data")
    if isinstance(data, dict) and isinstance(data.get("metadata"), dict):
        return str(data["metadata"].get("taskId") or "")
    return ""


def patch_node(node: dict[str, Any], repair: Repair) -> bool:
    metadata = node.get("metadata")
    if not isinstance(metadata, dict):
        data = node.get("data")
        metadata = data.get("metadata") if isinstance(data, dict) else None
    if not isinstance(metadata, dict):
        return False
    metadata.update(
        {
            "status": "error",
            "taskStatus": "failed",
            "taskStage": repair.stage,
            "generationSubmissionState": repair.dispatch_state,
            "generationErrorCode": repair.category,
            "errorDetails": repair.message,
            "taskOutcome": {
                "phase": "failed",
                "regenerate": "allowed",
                "reason": repair.outcome_reason,
            },
        }
    )
    return True


def backup_database(connection: sqlite3.Connection, backup_path: Path) -> None:
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    if backup_path.exists():
        raise SystemExit(f"refusing to overwrite existing backup: {backup_path}")
    destination = sqlite3.connect(str(backup_path))
    try:
        connection.backup(destination)
        destination.execute("PRAGMA quick_check").fetchone()
    finally:
        destination.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/srv/aicyld/canvas/data/open_ai_canvas.db")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    if args.apply and not args.backup:
        raise SystemExit("--apply requires --backup")

    database = Path(args.db)
    if not database.is_file():
        raise SystemExit(f"database not found: {database}")

    connection = sqlite3.connect(str(database), timeout=20)
    connection.row_factory = sqlite3.Row
    if args.apply:
        backup_database(connection, args.backup)

    tasks = connection.execute(
        """
        SELECT id, project_id, status, stage, error, provider_request_id,
               failure_diagnostics, recovery_outcome
        FROM tasks
        WHERE stage = 'submission_unknown'
        ORDER BY created_at
        """
    ).fetchall()

    repairs: list[tuple[sqlite3.Row, Repair]] = []
    skipped: list[dict[str, Any]] = []
    for task in tasks:
        attempts = connection.execute(
            "SELECT dispatch_state, provider_request_id, failure_code FROM route_attempts WHERE task_id = ? ORDER BY attempt_number",
            (task["id"],),
        ).fetchall()
        logs = connection.execute(
            """
            SELECT status, status_code, request_kind, provider_request_id,
                   error_code, error, response_body
            FROM api_call_logs
            WHERE task_id = ?
            ORDER BY created_at
            """,
            (task["id"],),
        ).fetchall()
        repair = evidence_for(task, attempts, logs)
        if repair:
            repairs.append((task, repair))
        else:
            skipped.append({"taskId": task["id"], "reason": "insufficient evidence; left unchanged"})

    repair_by_id = {task["id"]: repair for task, repair in repairs}
    projects = connection.execute(
        "SELECT id, payload_json, revision FROM canvas_projects WHERE payload_json LIKE '%submission_unknown%' OR payload_json LIKE '%generationSubmissionState\":\"unknown%'"
    ).fetchall()
    project_patches: list[tuple[str, str, int, int]] = []
    for project in projects:
        try:
            document = json.loads(project["payload_json"])
        except (TypeError, json.JSONDecodeError):
            continue
        changed = 0
        for node in document.get("nodes", []):
            if not isinstance(node, dict):
                continue
            repair = repair_by_id.get(node_task_id(node))
            if repair and patch_node(node, repair):
                changed += 1
        if changed:
            encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
            project_patches.append((project["id"], encoded, changed, int(project["revision"] or 0) + 1))

    report = {
        "mode": "apply" if args.apply else "dry-run",
        "database": str(database),
        "scanned": len(tasks),
        "repairable": len(repairs),
        "skipped": skipped,
        "tasks": [
            {
                "taskId": task["id"],
                "category": repair.category,
                "dispatchState": repair.dispatch_state,
                "confidence": repair.confidence,
            }
            for task, repair in repairs
        ],
        "projects": [
            {"projectId": project_id, "nodesChanged": changed, "nextRevision": next_revision}
            for project_id, _, changed, next_revision in project_patches
        ],
    }

    if args.apply:
        now = time.strftime("%Y-%m-%d %H:%M:%S%z")
        with connection:
            for task, repair in repairs:
                connection.execute(
                    """
                    UPDATE tasks
                    SET stage = ?, error = ?, failure_diagnostics = ?,
                        recovery_outcome = 'no_result',
                        completed_at = COALESCE(completed_at, ?),
                        updated_at = ?
                    WHERE id = ? AND stage = 'submission_unknown'
                    """,
                    (
                        repair.stage,
                        repair.message,
                        update_diagnostics(task["failure_diagnostics"], repair),
                        now,
                        now,
                        task["id"],
                    ),
                )
                connection.execute(
                    """
                    UPDATE route_attempts
                    SET dispatch_state = ?, failure_code = ?, failure_message = ?,
                        completed_at = COALESCE(completed_at, ?)
                    WHERE task_id = ? AND dispatch_state = 'submission_unknown'
                    """,
                    (repair.dispatch_state, repair.category, repair.message, now, task["id"]),
                )
            for project_id, encoded, _, next_revision in project_patches:
                connection.execute(
                    "UPDATE canvas_projects SET payload_json = ?, revision = ?, updated_at = ? WHERE id = ?",
                    (encoded, next_revision, now, project_id),
                )

    value = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(value + "\n", encoding="utf-8")
    print(value)
    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
