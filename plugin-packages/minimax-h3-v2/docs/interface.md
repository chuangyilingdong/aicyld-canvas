# MiniMax H3 V2 接口

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

## 参数与字段映射

见 manifest 的 `create.body`：`model` / `content` / `duration` / `resolution` / `ratio`，`content` 由 text + 参考素材（含 role）拼成。

<!-- BEEFTV_PLUGIN_MANIFEST_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "beeftv.plugin/v2",
  "id": "minimax-h3-v2",
  "name": "MiniMax H3（原生 V2）",
  "version": "1.0.0",
  "author": "灵动TV Contributors",
  "description": "MiniMax-H3 原生 V2 协议插件：POST /v2/video_generation 提交，GET /v2/query/video_generation/{task_id} 轮询。",
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
        "id": "minimax-h3-v2",
        "label": "MiniMax H3 Native V2",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.seedance.nz",
        "requiresPublicMediaUrls": true,
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
            "description": "MiniMax/Hailuo 视频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "仅写入 text content block，避免与顶层 prompt 重复。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "content[type=image_url]",
            "description": "保留 first_frame、last_frame、reference_image 等 role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "content[type=video_url]",
            "description": "映射为 reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "content[type=audio_url]",
            "description": "映射为 reference_audio/reference_voice。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "values": [
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
              "11",
              "12",
              "13",
              "14",
              "15"
            ],
            "mapping": "duration",
            "description": "4-15 秒。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "如 768P、1080P、2K；按模型能力限制。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "ratio",
            "description": "首尾帧模式自动使用 adaptive；其他模式使用用户比例。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "mapping": "aigc_watermark",
            "description": "AIGC 水印。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "模型支持时生成音频。"
          },
          {
            "name": "seed",
            "type": "integer",
            "mapping": "seed",
            "description": "providerOptions.minimax-video.seed。"
          },
          {
            "name": "prompt_optimizer",
            "type": "boolean",
            "mapping": "prompt_optimizer",
            "description": "providerOptions.minimax-video.prompt_optimizer。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "MiniMax H3 最多支持 9 张图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                3
              ]
            },
            "message": "MiniMax H3 最多支持 3 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "MiniMax H3 最多支持 3 个参考音频"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    4
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    15
                  ]
                }
              ]
            },
            "message": "MiniMax H3 duration 必须在 4-15 秒之间"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "image.role"
                          },
                          "first_frame"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "MiniMax H3 最多只能有一个首帧"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "image.role"
                          },
                          "last_frame"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "MiniMax H3 最多只能有一个尾帧"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "image.role"
                              },
                              "last_frame"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "image.role"
                              },
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "MiniMax H3 使用尾帧时必须同时提供首帧"
          },
          {
            "assert": {
              "$not": {
                "$and": [
                  {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "image",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "image.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "image",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "image.role"
                                },
                                [
                                  "reference_image",
                                  "subject_reference",
                                  "style_reference"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  }
                ]
              }
            },
            "message": "MiniMax H3 首尾帧模式不能混入普通角色或风格参考图"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video_generation",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
              "$concatArrays": [
                [
                  {
                    "type": "text",
                    "text": {
                      "$ref": "request.prompt"
                    }
                  }
                ],
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "image_url",
                      "image_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_image"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.videos"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_video"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.audios"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "audio_url",
                      "audio_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_audio"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "duration": {
              "$ref": "request.duration"
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "768P"
              ]
            },
            "ratio": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$in": [
                              {
                                "$ref": "image.role"
                              },
                              [
                                "first_frame",
                                "last_frame"
                              ]
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": "adaptive",
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/query/video_generation/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.task.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.task.status"
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
                "$ref": "response.task.message"
              },
              {
                "$ref": "response.base_resp.status_msg"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.error.message"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.task.content.url"
              },
              {
                "$ref": "response.content.url"
              }
            ]
          },
          "errorPaths": [
            "task.error.code",
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
