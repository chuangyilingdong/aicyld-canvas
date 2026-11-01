# Canvas 数据库迁移演练

## 目标

在隔离副本上验证官方迁移到 v29 和 AICYLD overlay v1，不接触生产库、不启动付费生成。

## 一致性副本

生产 SQLite 处于 WAL 模式，不能直接复制主库文件。使用 Python 内置 SQLite 的 backup API 生成在线一致性副本：

```bash
python3 scripts/canvas-db-audit.py copy \
  --source /srv/aicyld/canvas/data/open_ai_canvas.db \
  --destination /tmp/aicyld-migration/data/open_ai_canvas.db
```

## 迁移前快照

```bash
python3 scripts/canvas-db-audit.py snapshot \
  --db /tmp/aicyld-migration/data/open_ai_canvas.db \
  --out /tmp/aicyld-migration/before.json
```

快照记录所有业务表行数、`local_schema_migrations` 与 `aicyld_schema_migrations` 当前版本、`integrity_check` 和 `foreign_key_check`。

## 执行迁移

使用当前待发布后端的专用迁移命令。它不会启动 HTTP、任务 Worker 或恢复扫描：

```bash
CANVAS_BACKEND_DATA_DIR=/tmp/aicyld-migration/data \
/tmp/aicyld-migration/canvas-schema-migrate
```

命令会依次执行官方迁移、AICYLD overlay，并用只读版本检查确认两者都达到当前版本。

## 迁移后审计

```bash
python3 scripts/canvas-db-audit.py snapshot \
  --db /tmp/aicyld-migration/data/open_ai_canvas.db \
  --out /tmp/aicyld-migration/after.json

python3 scripts/canvas-db-audit.py compare \
  --before /tmp/aicyld-migration/before.json \
  --after /tmp/aicyld-migration/after.json
```

通过标准：

- `local_schema_version=29`
- `aicyld_overlay_version=1`
- `integrity_check=["ok"]`
- `foreign_key_violations=[]`
- 迁移前已有的表行数不变；新增表允许出现在 `added_tables`

## 边界

- 只审计数据库，不读取渠道密钥、对象存储凭据或支付配置。
- 副本目录放在 `/tmp` 或独立演练目录，不能覆盖生产数据目录。
- 迁移失败时保留副本和日志；生产回滚仍使用完整归档点。
