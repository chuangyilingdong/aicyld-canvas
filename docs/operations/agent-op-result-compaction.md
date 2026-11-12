# Agent 操作回执压缩

## 目标

`agent_op_records.result_json` 保存幂等回执。部分 `canvas.task.bind` 回执约 600KB，直接以 JSON 文本写入 SQLite，会造成数据库、备份和读取放大。

从 schema v32 开始：

- 超过 32KB 且压缩后小于原文 75% 的回执使用 `gzip+base64`；
- `result_json` 使用 `gzip+b64:` 前缀，兼容只查询该列的旧读取路径；
- `result_encoding` 记录压缩格式；
- GORM 读取时自动解压，业务代码仍看到原始 JSON；
- 小回执保持原文，不增加编码开销。

压缩不删除任何幂等记录，不改变操作 ID、payload hash 或状态语义。

## 首次压缩已有回执

先部署支持 schema v32 的后端，再执行：

```bash
python3 /srv/aicyld/canvas/src/scripts/compact-agent-op-results.py \
  --database /srv/aicyld/canvas/data/open_ai_canvas.db
```

该命令默认只预演。确认行数、原始字节和压缩后字节后加 `--apply`。

脚本按批更新并保留全部记录。SQLite 删除/重写后文件不一定立即缩小，可在维护窗口执行 `VACUUM`；不要在业务高峰执行。

## 安全边界

- 不要在仍运行 v31 或更早后端时压缩已有数据；旧后端不认识压缩前缀。
- 压缩前保留数据库备份或确认 OSS 实例可用。
- 回滚到旧后端前必须恢复压缩前数据库快照，或先把回执解压回明文。
- 本脚本不处理 `canvas.env`、资源文件、任务表或画布快照。

## 验证

```bash
python3 -m unittest scripts/test_compact_agent_op_results.py -v
```

压缩后至少检查：

- `PRAGMA quick_check` 为 `ok`；
- 大回执 `result_encoding='gzip+base64'`；
- 通过应用重放同一 `opId + payloadHash` 仍返回原结果；
- manifest/database 备份可正常恢复。
