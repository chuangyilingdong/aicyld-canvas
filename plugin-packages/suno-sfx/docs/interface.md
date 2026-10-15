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

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "suno-sfx",
  "name": "Suno Sound Effects",
  "version": "1.0.0",
  "author": "灵动TV Contributors",
  "description": "Suno 音效（Sound Effects）异步任务协议插件。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "suno-sfx",
        "label": "Suno Sound Effects",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.seedance.nz",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "prompt",
            "label": "描述",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "音效描述（生成什么声音）。"
          },
          {
            "name": "sound_length",
            "label": "时长（秒）",
            "type": "number",
            "required": false,
            "mapping": "extra.audioSeconds",
            "description": "音效时长（秒），可选。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/music/generations/sounds",
          "contentType": "application/json",
          "body": {
            "prompt": {
              "$ref": "request.prompt"
            },
            "sound_length": {
              "$omitEmpty": {
                "$ref": "request.extra.audioSeconds"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/music/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.0.task_id"
              },
              {
                "$ref": "response.data.0.id"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.data.0.status"
              },
              {
                "$ref": "response.data.status"
              },
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.data.fail_reason"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.msg"
              }
            ]
          },
          "audios": {
            "$coalesce": [
              {
                "$ref": "response.data.result.music.0.audio_url"
              },
              {
                "$ref": "response.data.result.music.0.url"
              },
              {
                "$ref": "response.data.result.music.0.audioUrl"
              },
              {
                "$ref": "response.data.audio_url"
              },
              {
                "$ref": "response.data.url"
              }
            ]
          },
          "errorPaths": [
            "error.code",
            "error.type",
            "data.fail_reason"
          ],
          "messagePaths": [
            "error.message",
            "message",
            "msg"
          ],
          "resultEphemeral": true,
          "resultKind": "audio"
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
