# RunningHub 标准图片协议

RunningHub 标准图片接口采用 Bearer API Key 和异步任务模型。宿主把渠道模型中的 `providerModelKey` 当作相对于 `https://www.runninghub.cn/openapi/v2` 的 endpoint，例如 `seedream-v5-pro/image-to-image`，不会根据模型显示名猜测接口路径。提交成功后保存 `taskId`，再向 `/openapi/v2/query` 发送查询请求，成功结果从 `results[].url` 读取。

## 接口

{{OPERATIONS}}

所有请求都必须发送 `Authorization: Bearer <API_KEY>` 和 `Content-Type: application/json`。创建响应的任务标识兼容 `taskId`、`task_id` 与 `id`，缺失时宿主直接报错，不把未知受理当成成功。查询状态兼容 `CREATE`、`QUEUED`、`RUNNING`、`SUCCESS`、`FAILED` 和 `CANCEL`。

## 模型

协议用于 RunningHub 的图像生成、图像编辑、图层拆分和多参考图编辑模型。文生图使用 `prompt`；图生图与编辑模型使用 `imageUrls`；带蒙版的编辑模型使用 `maskUrl`。按官方 schema，GPT Image 2.6 使用 `size`，GPT Image 2.5、Nano Banana 使用 `aspectRatio` 与 `resolution`，Seedream 比例尺寸会转换为 `width`、`height`，MiniMax H3 Image 使用 `size`、`n` 等字段。

## 参数

{{PARAMETERS}}

参考图片必须由宿主转换为 RunningHub 可访问的公网 HTTP(S) 地址。数据 URL、本机路径、私网地址和短时失效链接均不能直接提交。模型特有字段可以通过请求 metadata 中的 `providerOptions["runninghub-standard-image"]` 提供，适配器会在标准映射后合并这些明确配置，避免把未知字段硬编码进所有模型。

## 官方

- 文档：<https://www.runninghub.cn/runninghub-api-doc-cn/>
- 接入合同：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/tree/main/developer-kit>
- 模型注册表：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/developer-kit/model-registry.public.json>
- 价格预估接口：`POST https://www.runninghub.cn/openapi/v2/price-preview/**`

协议只实现已经声明的统一参数映射。上游新增字段必须补齐适配和测试后才能对外承诺。成功响应中的 `usage` 会作为供应商元数据保留，便于后续核对 RunningHub 实际扣费。

{{CONTRACT}}
