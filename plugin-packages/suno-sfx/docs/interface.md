# Suno Sound Effects 接口字段

## 协议身份

- 插件 ID：`suno-sfx`。Provider ID：`suno-sfx`。能力：`audio`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/music/generations/sounds`。
- 查询：`GET /v1/music/tasks/{{taskId}}`。

## 统一字段映射

| 统一字段 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- |
| `model` | 是 | 不参与请求 | Suno 按路径推导 SKU（`suno-sounds`），body 不接受 model |
| `prompt` | 是 | `prompt` | 音效描述，例如 `glass breaking on a wooden floor` |
| `extra.audioSeconds` | 否 | `sound_length` | 期望时长（秒） |

## 响应映射

| 位置 | 上游路径 |
| --- | --- |
| `taskId` | `data[0].task_id` |
| `status` | `data.status`（`completed` / `failed`） |
| `audios` | `data.result.music[0].audio_url` |

实测（2026-10-14）：一次生成返回 2 轨 mp3，¥0.0756。
