# {{NAME}}

上游把**图片生成**挂在异步任务接口上（ZhenZhen AI：`/v1/image/generations`，旧 `/v1/video/generations` 仅为兼容保留）。本适配器提交任务、轮询结果，最终下载图片。

## 接口

{{OPERATIONS}}

- 提交 body：`{"model": …, "prompt": …, "size": …, "images": [...]}`。
- **省略 `images` 即文生图；带 `images` 即参考图编辑**（上游语义：把参考图按顺序参与编辑，最多 15–16 张公开 HTTP(S) 图片地址）。
- 参考图必须以公网地址上传后传入：本适配器声明了「需要公网媒体 URL」，宿主会先把本地/资源中的图片转成可访问地址。

## 模型

模型名由画布模型渠道下发（例如 `zhenzhen-image-g-v2.5-lowprice`）。同一适配器服务该渠道下的所有 `newapi-image` 图片模型。

## 参数

{{PARAMETERS}}

## 官方

- 提交：`POST /v1/image/generations`
- 查询：`GET /v1/image/generations/{task_id}`（通用 TaskDto 响应，成功图片在 `data.result_url` / `data.data.*` 等位置）
- 文档：上游 `/docs`（图片生成章节）

## 宿主运行时合同

{{CONTRACT}}

- 结果直链有效期较短（约 2 小时），宿主必须及时下载转存；失败任务上游全额退款。