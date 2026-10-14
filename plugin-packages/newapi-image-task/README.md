# NewAPI Image Task

部分中转站（如 ZhenZhen AI）把图片模型挂在与视频相同的异步任务接口下：

- 提交：`POST /v1/video/generations`（JSON，`model` + `prompt`）
- 轮询：`GET /v1/video/generations/{task_id}`
- 产物：`data.data.content.image_url` / `image_urls`，或 `data.data.upstream.response.results[].url`

Provider ID：`newapi-image`，能力：`image`，鉴权：`bearer`。
