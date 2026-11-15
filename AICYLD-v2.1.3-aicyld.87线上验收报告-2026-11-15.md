# AICYLD v2.1.3-aicyld.87 线上验收报告

验收时间：2026-11-15

验收环境：`https://hb.aicyld.com.cn`

## 发布信息

- 版本：`v2.1.3-aicyld.87`
- 提交：`a95ae82e7f7a112a890ca84e94ed06092bb9f240`
- GitHub Actions：`43695704923`，成功
- 发布包 SHA256：`ed2cb162288ddc8051a3290ceabe5cd91c0a7587bedf7c6eba5281f24f9a6703`
- 前端入口：`/static/index-2XisSZeV.js`
- 部署前备份：`/srv/aicyld/canvas/backups/pre-release-v2.1.3-aicyld.87-20261115-084808`
- 上一版前端：`/srv/aicyld/canvas/.web-dist.prev-v2.1.3-aicyld.87-20261115-084808`

## 本次修复

### 批次制作页

- 删除无意义的“批次预算”；积分只在真正提交图片、视频任务时按实际任务计算。
- 剧本生成增加进度条：创建批次从 5% 开始，生成任务进度实时回写，保存剧本前到 95%，完成后 100%。
- 删除无后台逻辑支撑的“等待后台调度”面板。
- “批量操作”及其组件、hook、纯函数和专项测试全部删除。
- 删除单个项目的“暂停项目 / 继续项目 / 跳过”入口。
- “打开项目”改为含义明确的“查看项目”。

### 制作规格

- 删除“保存制作规格”按钮。
- 分镜方式、镜头数量、逐镜时长和目标总时长改为 700ms 防抖自动保存。
- 自动保存串行执行；请求期间继续修改时，会用最新值继续同步，避免旧响应覆盖新选择。
- 页面明确显示“保存中 / 已自动保存 / 等待同步”，创建项目按钮在保存完成前不可误点。

### 创建独立视频项目

- 创建按钮保留明确确认弹窗。
- 单条剧本创建成功后直接进入该项目的“角色与资产”页，不再停留在批次页让人误以为没有反应。
- 多条剧本仍创建为多个独立项目，互不合并。
- 项目创建后自动分析剧本所需资产；已有上传素材直接关联，缺失资产生成可修改的资产提示词。

### 画风

- 新建批次入口改为“选择/新建画风（可选）”。
- 风格中心支持系统风格、我的风格、收藏、最近使用和“新建风格”。
- 已选画风会写入每个独立项目，并注入资产分析与分镜提示词。
- 新增后端测试确认分镜提示词包含 `【项目画风】` 和所选风格内容。

### 资产到分镜

- 待确认资产候选在项目根目录直接显示，不再藏在“全部资产”筛选后。
- 候选卡片直接展示资产提示词。
- 新增“修改提示词”入口，用户可修改并保存资产外观、材质和关键特征后再生成资产图。
- “生成资产图”仍需要用户点击并确认费用，不会自动产生图片任务。
- 资产全部确认后，后端自动把可编辑的分镜提示词生成任务排入队列，不依赖用户返回批次页再刷新。
- 分镜提示词生成后，用户仍可在分镜工作台编辑、确认，再点击“生成分镜图”；视频仍作为最后独立步骤生成。

## 线上无付费验收

使用现有生产登录会话创建临时批次，不提交任何资产图、分镜图或视频生成任务：

1. 生产页面显示版本 `v2.1.3-aicyld.87`。
2. 选择固定分镜后页面显示“已自动保存”，接口返回 HTTP 200，服务端配置为 `productionMode=fixed`。
3. 确认“批次预算、等待后台调度、批量操作、保存制作规格、暂停项目、继续项目、跳过”均不存在。
4. 点击“创建独立视频项目”出现确认弹窗，文案明确说明资产分析与可修改提示词流程；验收时取消，不创建项目、不提交任务。
5. 新建批次页无批次预算，画风入口可打开风格中心，“新建风格”和“我的风格”可见。
6. 临时批次已删除，数据库无残留。

生产截图：

- `.local/smart-film-prod-87/01-production-autosaved.png`
- `.local/smart-film-prod-87/02-production-confirm-dialog.png`
- `.local/smart-film-prod-87/03-production-style-create.png`

## 本地真实交互验收

使用隔离后端和真实 Chrome 验证完整零付费链路：

1. 创建剧本批次并选择固定分镜。
2. 自动保存接口返回 HTTP 200，配置正确。
3. 创建项目后自动跳到“角色与资产”页。
4. 项目、章节和资产分析运行记录均已创建，资产阶段状态为 `queued`。
5. 注入一个零成本候选资产，卡片直接显示在根目录并展示提示词。
6. 点击“修改提示词”，修改并保存后，卡片与服务端 `detailsJson.prompt` 同步更新。
7. 画风中心支持“新建风格”和“我的风格”。

本地证据：

- `web/.local/smart-film-local-acceptance/01-autosaved.png`
- `web/.local/smart-film-local-acceptance/02-confirm-dialog.png`
- `web/.local/smart-film-local-acceptance/03-project-created-assets-page.png`
- `web/.local/smart-film-local-acceptance/04-asset-prompt-editor.png`
- `web/.local/smart-film-local-acceptance/05-asset-prompt-saved.png`
- `web/.local/smart-film-local-acceptance/06-style-picker-create.png`

## 验证结果

- GitHub Actions 官方 Linux 发布构建：成功
- Web TypeScript：通过
- Web ESLint：通过
- Vite 生产构建与 canvas bundle budget：通过
- 结构预算：通过
- 前端专项测试：17 项通过
- Go `internal/project`：通过
- Go `internal/repository`：通过
- Go `internal/smartfilm`：通过
- 生产 `/api/health`：ready，活动 Worker 任务 0
- SQLite `quick_check`：ok
- 部署后 `aicyld-canvas.service` 错误日志：无

补充说明：本地 Windows 环境执行全量 `go test ./...` 时，官方插件包尚未构建，且 Windows 缺少符号链接权限和 Unix 文件权限语义，相关协议/workspace 用例失败；同一提交已由 GitHub Actions 的 Linux 官方构建流程通过。本次未提交任何付费模型任务。
