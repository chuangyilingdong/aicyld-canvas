# RunningHub 标准音频协议

RunningHub 标准音频接口使用 Bearer API Key、异步 `taskId` 和统一查询接口。渠道模型中的 `providerModelKey` 必须是官方相对 endpoint，例如 `rhart-audio/text-to-audio/speech-2.8-hd`、`mureka-ai/mureka-v9/generate-song` 或 `kling-lip-sync/tts`。适配器不会根据显示名称推断音频 endpoint。

## 接口

{{OPERATIONS}}

创建请求发送到 `/openapi/v2/{providerModelKey}`，查询请求发送到 `/openapi/v2/query`，正文为 `{ "taskId": "..." }`。成功结果兼容 `results[].url` 与 `outputUrl`。失败、取消、成功但没有产物、以及提交响应没有任务 ID 都会返回真实错误，不会伪造静音或空音频。

## 模型

MiniMax Speech 2.8 HD 与 Turbo 使用 `text`、`voice_id`、`speed` 等字段；Mureka v9 歌曲生成使用 `prompt`、`lyrics`、`n` 与 `stream`；伴奏生成使用 `prompt`、`n` 与 `stream`；Kling 对口型语音合成使用 `text`、`voiceId`、`voiceLanguage`、`voiceSpeed`。不同端点的字段名不能互相替换。

## 参数

{{PARAMETERS}}

宿主统一输入中的 prompt 会映射到语音端点的 `text` 或音乐端点的 `prompt`。歌词来自任务配置的 `audioLyrics`，声音标识来自 `audioVoice`，语速来自 `audioSpeed`。模型特有字段可以在 `providerOptions["runninghub-standard-audio"]` 中显式配置，并在标准字段构造完成后合并。

## 官方

- 文档：<https://www.runninghub.cn/runninghub-api-doc-cn/>
- 模型注册表：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/developer-kit/model-registry.public.json>
- API 合同：<https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/blob/main/developer-kit/rh-api-contract.md>

音频生成按字符、时长或次数计费的模型需要使用对应的 RunningHub 价格规则。无法从公开结构化价格中还原单次成本的模型必须通过价格预估接口取得实际报价后再开放计费，不能把一个百万 Token 或一千字符单价直接当成本次任务单价。

{{CONTRACT}}
