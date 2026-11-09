# Canvas 生产构建移出 ECS

## 规则

生产服务器只负责运行，不在生产机上执行 `go build`、`bun install` 或 Vite 全量构建。

生产构建由 GitHub Actions `Build Canvas production release` 完成，产物包括：

- Linux amd64 `infinite-canvas-backend`
- 前端 `web-dist.tar.gz`
- 随包 Node 24.22.1 的 `agent-host.tar.gz`
- 统一发布包 `aicyld-canvas-<version>-<commit>.tar.gz`
- 发布包 `.sha256`
- 包内 `build-manifest.json` 和 `SHA256SUMS`

## 使用

1. 在 GitHub Actions 手动运行 `Build Canvas production release`。
2. 下载对应 commit 的发布包和 `.sha256`。
3. 上传发布包到服务器。
4. 用统一脚本校验并部署：

```bash
sudo /usr/local/sbin/deploy-canvas-release.sh \
  /tmp/aicyld-canvas-vX.Y.Z-abcdef12.tar.gz \
  "$(cat /tmp/aicyld-canvas-vX.Y.Z-abcdef12.tar.gz.sha256)"
```

5. 默认最多等待 300 秒让 `activeWorkerTasks` 归零；超时会停止发布，不会强停任务。
6. 脚本负责前端、后端、Agent 宿主、版本元数据和 SQLite 快照的备份、健康检查与自动回滚。
7. 发布后仍应人工检查 `/api/health`、`schema.ready`、页面入口和关键业务接口。

只校验、不改生产：

```bash
bash scripts/deploy-canvas-release.sh release.tar.gz <sha256> --verify-only
```

## 不再在生产机执行

```bash
go build ...
bun install ...
bun run build
```

生产机的 `src/web/node_modules` 和 `src/agent-host/node_modules` 只是构建缓存，不属于运行时依赖。运行中的 Agent Host 使用 `bin/agent-host` 内的依赖。

## 发布包约束

- 三个产物必须来自同一个 commit。
- 前端 `version.json`、后端 buildinfo、Agent 宿主源码和发布清单必须版本一致。
- Agent 宿主必须包含随包 Node、production 依赖和 `server.mjs`，不能在发布时使用服务器全局 Node。
- 部署脚本先切后端，健康通过后再切前端；任一步失败都会恢复旧前端、旧后端、旧 Agent 宿主、旧版本元数据和数据库快照。
