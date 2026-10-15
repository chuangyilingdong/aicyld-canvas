本插件由 灵动TV Contributors 维护，实现 MiniMax-H3 的原生 V2 协议（`POST /v2/video_generation`）。

# MiniMax H3（原生 V2）

该插件走上游 **MiniMax V2 原生协议**（api.seedance.nz，见其 /docs/minimax-h3-api.md）：

- 提交：`POST /v2/video_generation`，body = `model` + `content[]` + `duration` + `resolution` + `ratio`
- 轮询：`GET /v2/query/video_generation/{task_id}`，成功视频在 `task.content.url`
- `content[]`：`{"type":"text","text":…}`、`{"type":"image_url","image_url":{"url":…},"role":"reference_image|first_frame|last_frame"}`、video_url / audio_url 同理
- 分辨率只用 `480P` / `768P` / `1080P`；时长 4–15 秒整数；纯文本必须给固定比例，关键帧可用 `adaptive`
- **不能带**其它网关的字段（例如 `aigc_watermark`、`generate_audio`）——上游会以 `unsupported MiniMax-H3 field` 拒绝
