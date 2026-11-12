# AICYLD Canvas 生产备份保留策略

## 目标

生产目录同时保留数据库、后端、前端和渠道配置回滚点。发布频繁时，旧备份不能无限增长；清理策略必须默认可预演，并始终保留最新可恢复版本。

## 保留规则

`scripts/prune-production-backups.sh` 按修改时间从新到旧保留：

| 类型 | 默认保留 |
| --- | ---: |
| `infinite-canvas-backend*` 后端二进制 | 7 |
| `open_ai_canvas.db.*` 数据库快照 | 7 |
| `web-dist*.tar.gz` 前端压缩包 | 5 |
| `backups/web-dist*` 前端目录快照 | 2 |
| 生产根目录 `web-dist.prev*` 前端回滚目录 | 2 |
| `backups/pre-release-*` 完整发布回滚集 | 2 |
| `backups/pre-aicyld*` 旧版完整发布回滚集 | 2 |
| `backups/backend.pre-*` 旧后端回滚二进制 | 2 |

以下内容不在清理范围：

- 正在使用的 `web-dist`
- 正在准备的 `web-dist.new-*`
- 当前数据库、运行数据、插件和配置文件
- 无法识别的备份和运维文件
- `.retention-manifests` 审计记录

只有备份根目录的直接子项会被匹配。真正删除前，脚本还会校验候选路径的父目录必须等于已解析的备份根或生产根；任一异常都会终止整次清理。

## 手工操作

默认模式只打印计划，不删除：

```bash
/srv/aicyld/canvas/src/scripts/prune-production-backups.sh
```

确认当前回滚点仍在 `KEEP` 列表后执行：

```bash
/srv/aicyld/canvas/src/scripts/prune-production-backups.sh --apply
```

需要临时固定某个回滚点时重复传入 `--keep`：

```bash
/srv/aicyld/canvas/src/scripts/prune-production-backups.sh \
  --keep /srv/aicyld/canvas/backups/infinite-canvas-backend.20261024-142837 \
  --keep /srv/aicyld/canvas/backups/open_ai_canvas.db.20261024-144151-skills-clean \
  --apply
```

## 自动执行

本地清理不再使用独立定时器。`aicyld-canvas-oss-backup.service` 成功后通过 `OnSuccess=aicyld-canvas-backup-retention.service` 触发清理，确保 OSS 备份失败时不会先删除本地回滚点。服务以 root 运行，因为历史文件同时属于 `root`、`aicyld` 和 `www-data`。

安装或更新 unit：

```bash
install -m 0644 deploy/systemd/aicyld-canvas-backup-retention.service \
  /etc/systemd/system/aicyld-canvas-backup-retention.service
systemctl daemon-reload
systemctl disable --now aicyld-canvas-backup-retention.timer 2>/dev/null || true
```

查看下一次执行和最近日志：

```bash
journalctl -u aicyld-canvas-oss-backup.service -u aicyld-canvas-backup-retention.service --since -7days
```

## 验证

隔离测试不会触碰生产目录：

```bash
bash scripts/prune-production-backups.test.sh
```

生产清理后至少核对：

- `df -h /srv/aicyld/canvas`
- 最新后端、数据库、前端包和 `web-dist.prev-*` 均存在
- `/api/health` 返回 ready，`activeWorkerTasks` 为 0
- `aicyld-canvas`、`aicyld-main`、`aicyld-admin`、`nginx` 均为 active

## 回滚

清理不会覆盖当前运行文件。需要回滚前端时，停止继续发布后把选定的 `web-dist.prev-*` 恢复为 `web-dist`；回滚后端时，先停止 `aicyld-canvas`，替换二进制并恢复匹配的数据库快照，再启动服务。任何恢复都应先记录当前文件哈希并保留新的回滚点。

## OSS 备份与本地清理的顺序

每日 `aicyld-canvas-oss-backup.timer` 在 02:40 先执行 OSS 一致性备份；只有上传和远端大小校验全部成功后，systemd 才会触发本地保留策略清理旧回滚点。

OSS 备份的内容、路径和恢复步骤见 `docs/operations/oss-backup-restore.md`。
