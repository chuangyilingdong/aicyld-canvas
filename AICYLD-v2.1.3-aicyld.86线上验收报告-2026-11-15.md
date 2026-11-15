# AICYLD v2.1.3-aicyld.86 线上验收报告

验收时间：2026-11-15

验收环境：`https://hb.aicyld.com.cn`

## 发布信息

- 版本：`v2.1.3-aicyld.86`
- 提交：`67af888a468c9252be5eee737f43b95b004fed94`
- GitHub Actions：`43689399245`，成功
- 发布包 SHA256：`4591efc15f3b9e05e68a66bed1080ff19c757ffc4b90b7ef410b7634d69138fe`
- 前端入口：`/static/index-Df7-qK8V.js`
- 部署前备份：`/srv/aicyld/canvas/backups/pre-release-v2.1.3-aicyld.86-20261115-074739`
- 上一版前端：`/srv/aicyld/canvas/.web-dist.prev-v2.1.3-aicyld.86-20261115-074739`

## 修复内容

### 参考图改为分类添加

- 删除“本次添加类型”全局下拉框。
- 第一步骤现在直接显示四个分类区域：产品、场景、人物、道具。
- 每个分类都有自己的“添加图片”和“素材库”入口。
- 每类支持 0 张、1 张或多张；不要求每一类都必须有图片。
- 上传和素材库选择直接写入当前分类，不再需要上传后逐张调整全局类型。

### 修复上传后不显示

原问题链路：

1. 图片上传和素材保存成功。
2. 素材持久化时可能把本地临时素材 ID 合并为已有 canonical 资产 ID。
3. 页面仍保存旧的临时 ID，按旧 ID 查找素材时找不到，所以缩略图为空。

修复方式：

- `uploadWorkspaceAssetFiles` 在保存完成后按最终素材库状态解析 canonical ID。
- 上传返回的 `addedAssetIds` 现在始终指向最终可展示的素材。
- 参考图分类使用独立的业务角色，不依赖复用素材原有的全局分类。

## 线上验收

使用 hb 现有登录会话在生产页面实际执行：

1. 打开 `/smart-film/batches/new`。
2. 确认页面没有“本次添加类型”。
3. 确认存在产品、场景、人物、道具四个分类区域。
4. 点击产品区域的“添加产品”，实际上传一张 PNG 产品图。
5. 页面显示“已添加 1 张”。
6. 产品区域立即出现可见缩略图。
7. 服务端资产查询成功，上传资源已保存。
8. 页面无阻塞弹窗，分类和缩略图状态正常。

截图：`web/.local/reference-upload-check/reference-upload-success.png`

## 服务与资源

- `aicyld-canvas.service`：active
- `/api/health`：ready
- 后端版本和 commit：与发布包一致
- 活动 Worker 任务：0
- SQLite `quick_check`：ok
- Schema：44
- 部署后最近 10 分钟 service error：无
- `version.json` 中 1,149 个静态及懒加载资源：全部可用

## 本地验证

- `workspace-asset-upload.test.ts`：4 项通过
- `assets-collection-layout.test.ts`：9 项通过
- `smart-film-starter.test.ts`：3 项通过
- TypeScript：通过
- ESLint：通过
- Vite 生产构建：通过
- canvas bundle budget：通过
- 结构预算：通过

本次修复未提交任何付费模型任务。
