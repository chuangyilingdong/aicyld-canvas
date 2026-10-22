# Midjourney 异步图像协议

## 接口

本协议对接支持 Midjourney 任务网关的 OpenAI 兼容渠道。创建阶段使用
`POST /v1/midjourney/generations/{action}`，轮询阶段使用 `GET /v1/midjourney/tasks/{task_id}`。
请求体中的 `model` 固定为 `midjourney`，计费与路由身份由路径动作决定。

动作优先读取任务输入里的 `metadata.midjourney.action`；未提供时兼容旧的模型名后缀
`midjourney-<action>`，普通 `midjourney-imagine` 默认为 `imagine`。

{{OPERATIONS}}

当前支持 `imagine`、`upscale`、`variation`、`high-variation`、`low-variation`、`reroll`、`zoom`、
`pan`、`inpaint`、`modal`、`remix-strong`、`remix-subtle`、`blend`、`describe`、`edits`、`video`。
每个动作使用独立参数合同与必填校验，不能只扩展模型名。

## 动作合同

- `metadata.midjourney` 使用 camelCase 参数：`taskId`、`customId`、`index`、`direction`、
  `zoomRatio`、`dimensions`、`videoType`、`animateMode`、`motion`、`batchSize`、`endUrl`、
  `version`。宿主在发往上游时转换为对应 snake_case 字段。
- Imagine / Edits 的 `quality` 对应 Midjourney `--q`，取值为 `0.25`、`0.5`、`1`、`2`。
  它控制细节量，不是像素尺寸；像素比例仍由 `size`（`--ar`）决定，更高分辨率使用 upscale 动作。
- `taskId` 必须是 Midjourney 上游任务 ID，即任务记录里的 `providerRequestId`；不得使用 Canvas 的本地任务 ID。
- 图片选择的 `index` 从 `taskOutputIndex + 1` 自动推导为 1–4，也允许用户显式选择宫格位置；Video 的 `index` 是 0–3。
- `upscale`、`variation`、`high-variation`、`low-variation`、`inpaint`、`remix-strong`、
  `remix-subtle` 需要父任务与 `index`（或 `customId`）。`zoom`、`pan`、`inpaint` 只能接 upscale 单图；
  `reroll` 只能接 imagine/reroll；`remix-strong/subtle` 仅支持 v8.1/v8.2 父任务；v8 操作面板不再提供 upscale。
- `reroll`、`zoom`、`pan` 需要父任务；`pan` 还要求 `direction` 为 left/right/up/down。
- 上游当前会拒绝 Pan，即使父图来自 HD upscale；画布不把它作为可用动作，避免无效付费请求。
- `blend` 需要 2–4 张图片；`describe`、`edits` 需要至少一张图片。
- `video` 必须二选一：使用图片首帧，或使用 imagine 上游 `taskId`；`animateMode=auto` 时必须同时提供父任务与 0–3 的 `index`。
- 局部重绘为两阶段：先提交 `inpaint` 获得中间任务，再用该上游任务 ID 提交 `modal`，并提供透明区的
  PNG `mask_url` 与提示词。没有蒙版不得提交付费请求。Canvas 通过宿主 `POST /tasks/:id/midjourney/modal`
  续传同一个本地任务，禁止为 MODAL 再建第二个轮询任务。
- `describe` 结果写入文本节点；`video` 结果写入视频节点；其余动作写入图片节点。任务绑定按结果类型分流，
  不按请求能力把 describe/video 误判为图片。

## 模型

- `midjourney-imagine`：文生图或图片引导生成；请求支持 `prompt`、`image_urls`、`size`、`quality`、`version` 和 `speed`。
- `size` 取值为 `16:9`、`1:1`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`，最终由网关转换为 Midjourney 比例参数。
- `speed` 取值为 `relax`、`fast`、`turbo`，分别对应上游放松、快速和极速生成档位；默认 `relax`。
- 一次 `imagine` 请求对应一个付费任务。当前宿主把返回的 `grid_image_url` 作为单个四宫格结果保存；
  若网关不返回四宫格但返回 `image_urls`，则退回使用图片数组。
- 不支持的透明背景、输出格式和批量张数不会伪造发送，避免上游静默忽略或重复扣费。

## 参数

{{PARAMETERS}}

`quality` 在平台内部表示 Midjourney 速度档，而不是图像清晰度。用户显式选择的中、高质量字段不会被硬塞进该协议。
参考图必须已经是公开 HTTP(S) 地址；浏览器本地文件由宿主资源层先上传，再以 `image_urls` 提交。
蒙版必须与 inpaint 中间任务对应，并由资源层上传为网关可读取的 `mask_url`。

## 官方

上游公共模型目录将该动作归类为 Midjourney 图像模型，支持 `image-generation` endpoint。调用方必须遵守上游的
速率限制、内容合规、任务保留时间和媒体链接有效期要求。模型价格会随 relax、fast、turbo 档位变化，页面价格来自渠道配置或
上游公共价格接口，不能从模型名称静态推断。

{{CONTRACT}}
