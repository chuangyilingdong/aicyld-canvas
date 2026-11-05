# Canvas 生产构建移出 ECS

## 规则

生产服务器只负责运行，不在生产机上执行 `go build`、`bun install` 或 Vite 全量构建。

生产构建由 GitHub Actions `Build Canvas production artifacts` 完成，产物包括：

- Linux amd64 `infinite-canvas-backend`
- 前端 `web-dist.tar.gz`
- `build-manifest.json`
- `SHA256SUMS`

## 使用

1. 在 GitHub Actions 手动运行 `Build Canvas production artifacts`。
2. 下载对应 commit 的 artifact。
3. 在本地校验 `SHA256SUMS`。
4. 只把校验通过的产物上传到服务器。
5. 发布前备份当前 `bin/infinite-canvas-backend` 和 `web-dist`。
6. 发布后检查 `/api/health`、`schema.ready`、`activeWorkerTasks` 和页面入口。

## 不再在生产机执行

```bash
go build ...
bun install ...
bun run build
```

生产机的 `src/web/node_modules` 和 `src/agent-host/node_modules` 只是构建缓存，不属于运行时依赖。运行中的 Agent Host 使用 `bin/agent-host` 内的依赖。
