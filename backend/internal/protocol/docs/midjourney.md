# Midjourney 异步图像协议

## 接口

本协议对接支持 Midjourney 任务网关的 OpenAI 兼容渠道。创建阶段由宿主把模型名 `midjourney-<action>` 转为
`POST /v1/midjourney/generations/{action}`，请求体中的 `model` 固定为 `midjourney`，计费与路由身份由路径动作决定。
轮询阶段使用 `GET /v1/midjourney/tasks/{task_id}`，直到任务进入成功或失败终态。

{{OPERATIONS}}

当前基础接入只开放 `midjourney-imagine`。后续 `upscale`、`variation`、`pan`、`zoom`、`blend`、`describe` 和视频动作必须逐个补齐参数与结果合同，不能仅添加模型名。

## 模型

- `midjourney-imagine`：文生图或图片引导生成；请求支持 `prompt`、`image_urls`、`size` 和 `speed`。
- `size` 取值为 `16:9`、`1:1`、`9:16`、`4:3`、`3:4`、`3:2`、`2:3`，最终由网关转换为 Midjourney 比例参数。
- `speed` 取值为 `relax`、`fast`、`turbo`，分别对应上游放松、快速和极速生成档位；默认 `relax`。
- 一次 `imagine` 请求对应一个付费任务。当前宿主把返回的 `grid_image_url` 作为单个四宫格结果保存；若网关不返回四宫格但返回 `image_urls`，则退回使用图片数组。
- 不支持的蒙版、透明背景、输出格式和批量张数不会伪造发送，避免上游静默忽略或重复扣费。

## 参数

{{PARAMETERS}}

`quality` 在平台内部表示 Midjourney 速度档，而不是图像清晰度。用户显式选择的中、高质量字段不会被硬塞进该协议。
参考图必须已经是公开 HTTP(S) 地址；浏览器本地文件由宿主资源层先上传，再以 `image_urls` 提交。

## 官方

上游公共模型目录将该动作归类为 Midjourney 图像模型，支持 `image-generation` endpoint。调用方必须遵守上游的
速率限制、内容合规、任务保留时间和媒体链接有效期要求。模型价格会随 relax、fast、turbo 档位变化，页面价格来自渠道配置或
上游公共价格接口，不能从模型名称静态推断。

{{CONTRACT}}
