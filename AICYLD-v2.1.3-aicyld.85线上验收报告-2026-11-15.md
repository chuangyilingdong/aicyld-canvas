# AICYLD v2.1.3-aicyld.85 线上验收报告

验收时间：2026-11-15

验收环境：`https://hb.aicyld.com.cn`

## 发布信息

- 版本：`v2.1.3-aicyld.85`
- 提交：`c52e45e1c2fc48385c8a5c2c3fe17cc17ab23a7e`
- GitHub Actions：`43686305493`，成功
- 发布包 SHA256：`f2d0b53c77707722ab10f38cbf120baf57a6c5149d7e58611e294277fd0ac0ab`
- 前端入口：`/static/index-do0AJ8ej.js`
- 部署前备份：`/srv/aicyld/canvas/backups/pre-release-v2.1.3-aicyld.85-20261115-065524`
- 上一版前端：`/srv/aicyld/canvas/.web-dist.prev-v2.1.3-aicyld.85-20261115-065524`

## 修复内容

分镜工作台底部操作栏原先使用单行不换行按钮，在 1440×1100 等常见宽度下会伸入右侧产物预览面板，导致主操作按钮被遮挡。

本次修复：

- 操作栏允许按行换行，并严格限制在当前编辑列宽度内。
- 主生成按钮保留右对齐。
- 操作栏禁止横向溢出到右侧预览栏。
- 现有结构预算和工作台文件行数未增加。

## 线上布局验收

使用线上真实项目页，在以下四档视口宽度逐一检查：

- 1440×1100
- 1280×1100
- 1024×1100
- 800×1100

结果：

- 操作栏与右侧预览面板重叠宽度：0
- 删除镜头：完整可见，可点击
- 保存脚本：完整可见，可点击
- 确认全部提示词：完整可见，可点击
- 补齐全部分镜图：完整可见，可点击
- 生成分镜图：完整可见，可点击

四档宽度下按钮中心点击均命中按钮本身，不再被 `.workflow-preview-panel` 拦截。

## 服务与资源

- `aicyld-canvas.service`：active
- `/api/health`：ready
- 后端版本和 commit：与发布包一致
- 活动 Worker 任务：0
- SQLite `quick_check`：ok
- Schema：44
- 部署后最近 10 分钟 service error：无
- 线上 `version.json` 清单中的 1,149 个静态及懒加载资源：全部可用

## 本地回归

- TypeScript：通过
- ESLint：通过
- Vite 生产构建：通过
- canvas bundle budget：通过
- 结构预算：通过，`workflow-production-workbench.tsx` 未增加行数

## 证据

- 本地截图：`web/.local/workflow-actions-layout-check.png`
- 线上响应式检查：`web/.local/workflow-actions-responsive-check.mjs` 运行结果
- 线上版本：`v2.1.3-aicyld.85`
