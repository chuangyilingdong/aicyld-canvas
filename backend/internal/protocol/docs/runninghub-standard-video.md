# RunningHub 标准视频协议

RunningHub 标准视频接口采用 Bearer API Key 和异步任务模型。渠道中的 `providerModelKey` 必须填写模型注册表里的相对 endpoint，例如 `bytedance/seedance-2.5-token/text-to-video` 或 `kling-v4/image-to-video`。宿主动态拼接 `/openapi/v2/{endpoint}`，提交后使用 `/openapi/v2/query` 按 `taskId` 轮询。

## 接口

{{OPERATIONS}}

创建响应的 `taskId` 会被持久化用于任务恢复。查询状态 `CREATE`、`QUEUED`、`RUNNING` 为非终态，`SUCCESS` 为成功，`FAILED` 与 `CANCEL` 为失败。成功结果优先读取 `results[].url` 与 `outputUrl`，并根据 `outputType` 或扩展名判断图片、视频和音频。

## 模型

协议支持 RunningHub 的文生视频、图生视频、首尾帧、多模态参考生视频、全能参考、动作控制、数字人、对口型和视频增强模型。Seedance 多模态使用 `imageUrls`、`videoUrls`、`audioUrls`；Seedance 与 MiniMax H3 的图生视频使用 `firstFrameUrl`、`lastFrameUrl`；Kling 4.0 图生视频使用 `firstImageUrl`、`lastImageUrl`；Kling 全能参考使用 `imageUrls` 与 `videoUrl`。

## 参数

{{PARAMETERS}}

Seedance 与 H3 使用 `ratio`，Kling 与万相使用 `aspectRatio`。Seedance 附带稳定的画质、输出格式、种子、尾帧和 draft 默认值；H3 水印使用 `aigc_watermark`；万相使用 `audio` 与 `watermark`。RH Upscale 使用官方要求的特殊字段名；对口型和数字人端点只发送其 schema 声明的媒体字段，不把通用的时长、画质字段强行注入。

## 官方

- 文档：<https://www.runninghub.cn/runninghub-api-doc-cn/>
- 模型注册表：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/developer-kit/model-registry.public.json>
- API 合同：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/developer-kit/rh-api-contract.md>

输入视频、音频和图片必须是 RunningHub 可访问的公网 HTTP(S) 地址，并且需要在任务完成前保持有效。模型特有字段通过 `providerOptions["runninghub-standard-video"]` 显式传入。价格和额度不在协议中猜测，使用 RunningHub 价格预估和任务响应中的实际用量核对。

{{CONTRACT}}
