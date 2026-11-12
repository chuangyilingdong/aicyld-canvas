# AICYLD Canvas OSS 备份与恢复

## 自动任务

- `aicyld-canvas-oss-backup.timer` 每天 02:40 触发，随机延迟最多 15 分钟。
- 备份先完成一致性快照和 OSS 上传校验，成功后才退出 0。
- 只有备份成功后，systemd 才通过 `OnSuccess` 触发本地回滚点清理；备份失败不会删除本地文件。

## 备份内容

- `open_ai_canvas.db` 的 SQLite 一致性快照
- `data/sessions/**/*.sqlite` 的一致性快照
- `data/resources` 用户资源，按 SHA256 内容地址存入共享对象前缀
- `data/plugin-packages`、`data/skill-packages`
- 后端二进制、Agent Host 运行时、当前前端
- 最近 2 个前端回滚目录，合并成一个压缩对象
- `VERSION`、`RELEASE.json`、`oss-index.json`

`canvas.env` 含密钥，不进入 OSS 备份。恢复时应从安全配置渠道重新注入。

本地 `backups/` 存放发布回滚点、数据库快照和历史调查材料，不进入 OSS 日常备份。这样可避免历史发布目录里的 `node_modules` 被逐文件上传，导致对象数爆炸和 systemd 超时。OSS 保存的是当前可恢复状态，本地回滚点由 `prune-production-backups.sh` 单独治理。

备份开始上传前会做对象数和总大小检查，默认最多 `5000` 个对象、`8 GiB`；超过任一上限会直接失败，不进入逐对象上传。备份完成后还会检查 `90` 分钟耗时预算，超时会保留完整备份但让服务返回失败，以触发告警并禁止后续本地清理。

## OSS 路径

```text
oss://<bucket>/<CANVAS_OSS_PATH_PREFIX>/backups/daily/<UTC timestamp>/
oss://<bucket>/<CANVAS_OSS_PATH_PREFIX>/backups/shared/resources/objects/<sha256>
```

每次备份根目录包含：

```text
db/open_ai_canvas.db
sessions/...
data/resources/...
data/plugin-packages/...
data/skill-packages/...
bin/...
release/...
meta/...
manifest.json
manifest.json.sha256
```

`data/resources` 不再每天复制到新的 daily 前缀。每个文件按内容 SHA256 写入 `backups/shared/resources/objects/<sha256>`；manifest 同时记录 OSS `key` 和原始恢复路径 `restorePath`。同内容文件只上传一次，后续每日备份只上传新增或变化的资源。

第一次启用该格式时会经历一次完整资源上传；之后正常日备只需要上传数据库、Web、Agent Host、回滚包和新增资源。

## 恢复顺序

1. 先在隔离目录恢复，不要覆盖线上。
2. 下载 `manifest.json` 并校验 `manifest.json.sha256`。
3. 恢复数据库快照到 `data/open_ai_canvas.db`，确认文件属主为 `aicyld:aicyld`、权限 `0640`。
4. 恢复 Agent 会话到 `data/sessions/`，保持原相对路径。
5. 按 manifest 的 `restorePath` 把共享资源对象恢复到 `data/resources`；不要按对象哈希路径直接还原。
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
  --work-dir /var/tmp --apply --workers 4 \
  --max-objects 5000 --max-bytes 8589934592 \
  --max-duration-seconds 5400
```

不带 `--apply` 时只生成计划，不上传。

## OSS 保留策略

- `aicyld-canvas-oss-backup.timer` 每天 02:40 生成当前状态备份。
- `aicyld-canvas-backup-retention.service` 只在备份成功后清理本地旧回滚点。
- `aicyld-canvas-oss-retention.timer` 每天 04:10 清理超过 30 天的 OSS 完整备份前缀。
- OSS 清理以本机 `backups/oss-manifests/*.json` 为唯一删除依据，不通过猜测或裸列举删除。
- 清理旧 daily run 时不会直接删除 shared 对象；只有不再被任何保留 manifest 引用时，才会回收对应内容对象。
- 已清理清单移动到 `backups/oss-manifests/pruned/`，保留审计记录。
