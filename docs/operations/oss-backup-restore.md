# AICYLD Canvas OSS 备份与恢复

## 自动任务

- `aicyld-canvas-oss-backup.timer` 每天 03:40 触发，随机延迟最多 15 分钟。
- 备份先完成一致性快照和 OSS 上传校验，成功后才退出 0。
- `aicyld-canvas-backup-retention.timer` 04:20 才清理本地旧回滚点，因此正常顺序是“先备份、后清理”。

## 备份内容

- `open_ai_canvas.db` 的 SQLite 一致性快照
- `data/sessions/**/*.sqlite` 的一致性快照
- `data/resources` 用户资源
- `data/plugin-packages`、`data/skill-packages`、`data/workspace`
- `backups/*` 历史回滚点
- 后端二进制、Agent Host 运行时、当前前端和历史前端回滚点
- `VERSION`、`RELEASE.json`、`oss-index.json`

`canvas.env` 含密钥，不进入 OSS 备份。恢复时应从安全配置渠道重新注入。

## OSS 路径

```text
oss://<bucket>/<CANVAS_OSS_PATH_PREFIX>/backups/daily/<UTC timestamp>/
```

每次备份根目录包含：

```text
db/open_ai_canvas.db
sessions/...
data/resources/...
data/plugin-packages/...
data/skill-packages/...
data/workspace/...
backups/...
bin/...
release/...
meta/...
manifest.json
manifest.json.sha256
```

## 恢复顺序

1. 先在隔离目录恢复，不要覆盖线上。
2. 下载 `manifest.json` 并校验 `manifest.json.sha256`。
3. 恢复数据库快照到 `data/open_ai_canvas.db`，确认文件属主为 `aicyld:aicyld`、权限 `0640`。
4. 恢复 Agent 会话到 `data/sessions/`，保持原相对路径。
5. 恢复 `data/resources`、插件和技能包。
6. 恢复后端二进制、Agent Host 运行时或前端回滚目录。
7. 从安全配置渠道恢复 `canvas.env`，不要把密钥写入工单或聊天。
8. 启动服务后检查：
   - `/api/health`
   - `schema.ready=true`
   - `activeWorkerTasks=0` 后再进行写入验收
   - 主站、画布、后台、Nginx 均为 `active`

## 手工执行

```bash
/usr/bin/python3 /srv/aicyld/canvas/bin/backup-to-oss.py \
  --canvas-root /srv/aicyld/canvas \
  --env-file /srv/aicyld/canvas/canvas.env \
  --work-dir /var/tmp --apply --workers 4
```

不带 `--apply` 时只生成计划，不上传。

## OSS 保留策略

- `aicyld-canvas-oss-backup.timer` 每天 03:40 生成完整备份。
- `aicyld-canvas-oss-retention.timer` 每天 04:10 清理超过 30 天的完整备份前缀。
- OSS 清理以本机 `backups/oss-manifests/*.json` 为唯一删除依据，不通过猜测或裸列举删除。
- 已清理清单移动到 `backups/oss-manifests/pruned/`，保留审计记录。
