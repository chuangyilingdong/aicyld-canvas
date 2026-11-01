本插件由 灵动TV Contributors 维护，实现 MiniMax-H3 的原生 V2 协议（上游 api.seedance.nz，见其 `/docs/minimax-h3-api.md`）。

## 接口

- 提交：`POST /v2/video_generation`，body = `model` + `content[]` + `duration` + `resolution` + `ratio`
- 轮询：`GET /v2/query/video_generation/{task_id}`

## 请求要点

- `model` 固定 `MiniMax-H3`（区分大小写）。
- `content[]`：`{"type":"text","text":…}`；`{"type":"image_url","image_url":{"url":…},"role":"reference_image|first_frame|last_frame"}`；`video_url` / `audio_url` 同理（role 用 `reference_video` / `reference_audio` / `drive_audio`）。
- `resolution`：只接受 `480P` / `768P` / `1080P`。
- `duration`：4–15 秒整数（带 `drive_audio` 时 4–60）。
- `ratio`：纯文本必填固定比例；关键帧请求可用 `adaptive`。
- **不要**带其它网关的字段（`aigc_watermark`、`generate_audio` 等），上游会以 `unsupported MiniMax-H3 field` 拒绝。

## 响应映射

- 提交响应取 `task_id`；轮询响应取 `task.status`（`queued` / `running` / `succeeded` / `failed` / `cancelled`）与 `task.status` 成功时的 `task.content.url`。
- 失败信息取 `task.error.code` / `task.error.message`。

## 鉴权

Bearer `apiKey`（配置字段名 `apiKey`）。
