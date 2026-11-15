# AICYLD v2.1.3-aicyld.89 线上验收报告

验收时间：2026-11-15

验收环境：`https://hb.aicyld.com.cn`

## 发布信息

- 版本：`v2.1.3-aicyld.89`
- 提交：`fb45a091a9a3ad63d60fa9f3d54ab7877973682b`
- GitHub Actions：`43700502746`，成功
- 发布包 SHA256：`f70b58b2324ccafe86b7e11b711d5d6f4caab1014597d3b0871961c37c9ddb77`
- 前端入口：`/static/index-lZWTy8JJ.js`
- 部署前备份：`/srv/aicyld/canvas/backups/pre-release-v2.1.3-aicyld.89-20261115-094753`
- 上一版前端：`/srv/aicyld/canvas/.web-dist.prev-v2.1.3-aicyld.89-20261115-094753`

## 修复一：单文件上传出现两个进度项

根因：外层“批量添加素材”创建了一条批次进度，同时底层资源上传又为每个文件创建了独立进度，因此上传 1 个文件会显示 2 项。

修复：

- 批次上传由外层统一展示一条进度。
- 单文件上传不再创建第二条底层进度。
- 文件传输字节数仍实时汇总到外层进度。
- 多文件上传同样只显示一条汇总进度和完成文件数。

生产验证：上传 1 张 PNG 时，进度托盘最大同时只出现 1 项，标题为“添加素材”，并显示单文件字节进度。

截图：`.local/upload-progress-89/single-file-progress.png`

## 修复二：剧本生成成功但批次显示 0 条

根因：对截图中的真实失败批次排查后确认，模型任务 `2f412bddd4e4c55ebf7fc920c5ae4ccb` 在 17:30:30 已成功完成，数据库中存在 3 条完整剧本；但前端没有发出保存剧本请求，所以批次留下 0 条剧本。这不是模型中断。

修复：

- 新增后端恢复接口 `POST /smart-film-batches/:id/recover-scripts`。
- 接口只在当前批次已有剧本为空时，查找同一用户、同一 `batchId`、来源为 `smart-film-batch-script` 的已成功文本任务。
- 从任务结果中解析剧本并走正式保存链路，不重复调用模型、不再次扣费。
- 批次页打开且剧本为空时自动尝试恢复一次。
- 空态保留“恢复上次生成结果”手动入口，并明确恢复失败后再重新生成。

生产验证：直接打开截图中原来的 0 剧本批次 `2a31e59b358c461d61d1a9f61d783f27`，系统自动恢复出 3 条剧本：

1. 玩具只会站柜？沧龙不同意
2. 时空守护鲸撞上暗黑沧龙
3. 三秒证明谁是桌面C位

截图：`.local/batch-recovery-2a31.png`

## 验证结果

- GitHub Actions 官方 Linux 发布构建：成功
- Web TypeScript、ESLint、Vite 生产构建、bundle budget、结构预算：通过
- 前端专项测试：17 项通过
- Go `internal/project`：通过，包括从成功任务恢复剧本
- Go `internal/repository`：通过
- Go `internal/handler` OpenAPI smart-film 定向测试：通过
- 生产 `/api/health`：ready，活动 Worker 任务 0
- 部署后 `aicyld-canvas.service` 错误日志：无
- 本次验收未新增付费模型任务
