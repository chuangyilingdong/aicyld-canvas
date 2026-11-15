# AICYLD v2.1.3-aicyld.84 线上验收报告

验收时间：2026-11-15

验收环境：`https://hb.aicyld.com.cn`

## 发布信息

- 版本：`v2.1.3-aicyld.84`
- 提交：`c7821f841446ec01f41db6acb32f99369a64b8b0`
- GitHub Actions：`43681475991`，成功
- 发布包 SHA256：`89cce88228880b731e5a7c2b6c1cac4a175a53aee5283e763a0dde338a1728fe`
- 前端入口：`/static/index-C64TklOR.js`
- 部署前备份：`/srv/aicyld/canvas/backups/pre-release-v2.1.3-aicyld.84-20261115-055812`
- 上一版前端：`/srv/aicyld/canvas/.web-dist.prev-v2.1.3-aicyld.84-20261115-055812`

## 服务与数据

- `aicyld-canvas.service`：active
- `/api/health`：ready
- 后端版本和 commit：与发布包一致
- 活动 Worker 任务：0
- SQLite `quick_check`：ok
- Schema：44
- 部署后最近 15 分钟 service error：无
- 临时验收项目删除后数据库残留：0

## 静态资源

读取线上无缓存 `version.json`，对其 `files` 清单中的 1,149 个静态资源和懒加载资源逐一请求校验，全部可用，失败数 0。

## 浏览器验收

使用用户已有的 hb 登录会话，在线上创建临时短剧项目，并上传两段本地合成的 1.2 秒测试视频。两段测试视频均通过本机 ffmpeg 时间线渲染登记为镜头产物，不涉及模型渠道。

通过项：

- 交付页显示双镜头成片时间线和双字幕轨。
- 输出规格显示为 `2.4s · 1280×720`，与项目 16:9 画幅一致。
- 点击“在编辑器中编排”后，编辑器自动生成 4 个片段、2 条轨道。
- 镜头产物自动同步到项目素材库。
- 选中第二镜后，可用同类型素材替换，时间线位置和时长保持不变。
- 浏览器控制台错误：0。
- 临时项目已删除，临时渲染任务已取消或完成，无活动 Worker 任务。
- 未提交任何付费模型任务。

截图与证据：

- `web/.local/hb-timeline-acceptance-20261115/delivery-timeline.png`
- `web/.local/hb-timeline-acceptance-20261115/editor-replaced.png`
- `web/.local/hb-timeline-acceptance-20261115/report-2026-11-15T05-59-33-150Z.json`
- `web/.local/hb-timeline-acceptance-20261115/static-assets-report.json`

## 回滚

如需回滚，可停止服务后恢复备份目录中的后端、`RELEASE.json`、`VERSION` 与 SQLite 快照，并把 `.web-dist.prev-v2.1.3-aicyld.84-20261115-055812` 恢复为 `web-dist`，然后重启 `aicyld-canvas` 并重载 nginx。
