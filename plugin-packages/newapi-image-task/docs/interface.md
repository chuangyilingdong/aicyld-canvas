# NewAPI Image Task

部分中转站（如 ZhenZhen AI）把图片模型挂在与视频相同的异步任务接口下：

- 提交：`POST /v1/video/generations`（JSON，`model` + `prompt`）
- 轮询：`GET /v1/video/generations/{task_id}`
- 产物：`data.data.content.image_url` / `image_urls`，或 `data.data.upstream.response.results[].url`

Provider ID：`newapi-image`，能力：`image`，鉴权：`bearer`。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "newapi-image-task",
  "name": "NewAPI Image Task",
  "version": "1.0.1",
  "author": "AICYLD",
  "description": "上游把图片生成挂在异步任务接口时使用的声明式协议：POST /v1/video/generations 提交，GET /v1/video/generations/{task_id} 轮询取回图片地址。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "permissions": [
    "network"
  ],
  "contributes": {
    "providers": [
      {
        "id": "newapi-image",
        "label": "NewAPI 图片任务（异步）",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation"
        ],
        "baseUrl": "https://api.example.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size",
            "description": "比例或尺寸。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/video/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$ref": "request.imageCount"
                      },
                      0
                    ]
                  },
                  "then": {
                    "$ref": "request.imageCount"
                  },
                  "else": null
                }
              }
            },
            "size": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.aspectRatio"
                          }
                        }
                      },
                      [
                        "",
                        "auto"
                      ]
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            },
            "images": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/video/generations/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.data.taskId"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.data.status"
              },
              {
                "$ref": "response.data.data.status"
              },
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.fail_reason"
              }
            ]
          },
          "images": {
            "$coalesce": [
              {
                "$ref": "response.data.data.content.image_url"
              },
              {
                "$ref": "response.data.data.content.image_urls"
              },
              {
                "$ref": "response.data.data.url"
              },
              {
                "$ref": "response.data.data.output_url"
              },
              {
                "$ref": "response.data.data.result_url"
              },
              {
                "$ref": "response.data.url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.data.upstream.response.results"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- BEEFTV_PLUGIN_MANIFEST_END -->
