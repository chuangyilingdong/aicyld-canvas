# Changelog

All notable public changes to BeefTV are documented in this file.

## v2.1.3-aicyld.66

- 视频/图片反推提示词：已有的失败结果节点在重试时会自动把不兼容的普通文本模型切换为支持媒体输入的多模态模型，无需删除节点后重建。

## v2.1.3-aicyld.65

- 视频/图片反推提示词：结果节点优先选择支持视频或图片输入的多模态文本模型，不再默认绑定普通聊天模型。
- 提交校验：文本模型声明不支持参考视频或参考图片时，在创建生成任务前直接提示并阻止提交，避免上游返回 `invalid_params`。
- 媒体引用：支持多模态模型声明参考图片和参考视频数量上限，超出时返回可操作提示。

## v2.1.3-aicyld.64

- 素材库、技能、插件和账户入口统一为同一套页头、分类标签、卡片表面和交互节奏；账户菜单补充积分概览、充值入口以及素材/技能/插件/设置快捷入口。
- 素材完整性：新增只读审计和失效素材归档工具，检查同一 Resource 多素材、同内容多 Resource、本地文件缺失和孤立素材。
- 存量修复：归档 165 条缺文件素材和 1 条孤立测试素材，保留 Resource、画布文档和历史快照，不删除资源文件。

## v2.1.3-aicyld.63

- 外部 Agent：新增 `task.wait`，一次最多等待 8 个原任务、最长 25 秒；超时返回 `pending`，可继续查询而不重复提交生成。
- 批量节点：新增 `canvas.nodes.get` 与 `canvas.nodes.configure`，支持一次读取 1–50 个节点、原子配置最多 20 个媒体节点，整批成功只推进一次画布版本。
- Agent 指南：新增外部专用 `agent.guide`，内容与随包画布技能保持一致并返回内容哈希；内置创作助手不可见这些外部专用操作。
- MCP：默认工具集补齐外部创作基础闭环，新增 `task.wait`、批量节点操作和指南；付费原地重做仍保持独立版本，不在本版开放。

## v2.1.3-aicyld.62

- 素材库：上传层改为按文件内容复用资源身份；同一文件即使重新选择、改名或在创作助手中再次添加，也不会再生成新的素材记录。
- 创作助手：重新添加已有文件时沿用服务端返回的规范素材，不再因本地草稿 ID 不同而登记失败。
- 存量修复：发布时清理同一账号、同一类型下内容完全相同的活动素材，并同步修正画布、历史快照和项目素材引用；资源文件本身不删除。

## v2.1.3-aicyld.61

- 画布文件夹：点击折叠文件夹会打开全屏网格，可搜索、播放预览、批量下载、重命名、移出单个节点或一键解散。
- 多选收纳：选中至少两个非容器节点后，可从选区工具栏或右键菜单直接收纳到新文件夹。
- 问助手：从选区点击“问助手”会打开右侧对话并聚焦输入框，当前选区继续自动随消息附带。

## v2.1.3-aicyld.60

- 视频处理：视频节点新增“视频去字幕”，支持自动识别或框选区域、标准无痕或花字增强，并在提交前显示预估费用。
- 动态模型目录：超分模型由服务端 `media-upscale/capabilities` 下发，不再依赖前端硬编码；目录暂时不可用时保留现有默认模型。
- 结果恢复：去字幕与超分继续复用原任务恢复流程，支持保留原视频音轨，失败后区分“取回原结果”和“重新配置”，避免重复扣费。

## v2.1.3-aicyld.59

- 分镜脚本：单次 `canvas_script_prepare` 最多 8 行，超出后使用 `canvas_script_rows_append` 按每批 8 行继续追加。
- 整片提案：`productionNodeIds` 每批最多 24 个目标，超出时拆成多批确认，避免一次提案过大或失败后反复重做。

## v2.1.3-aicyld.58

- 长耗时任务：前端等待改为以服务端最终状态为准，不再按图片、视频类型提前超时；任务失败时保留服务端结论、错误码和诊断信息。
- 失败恢复：后台已判定不可取回的结果，不会再被前端“继续取回”状态覆盖。
- 视频参考：连接角色卡、参考视频、参考音频或超过首尾帧图片上限时，自动切换为全能参考模式；连接 1–2 张图片时继续优先使用首尾帧模式。

## v2.1.3-aicyld.57

- 技能选择：技能菜单支持点击菜单外区域或按 `Esc` 收起，不再要求再次点击技能图标才能关闭。
- 技能状态：安装与启用明确分开；菜单显示已安装数量和本轮已启用数量，未点击启用的技能不会带入本轮对话。
- 技能说明：每项技能直接显示“已安装，点击启用”或“已启用，本轮会使用”，并新增“完成”按钮。

## v2.1.3-aicyld.56

- 素材库：修复画布恢复、结果回填和重复提交时把同一媒体资源反复写成多条素材的问题；同一资源现在始终复用同一条素材记录。
- 存量修复：发布时自动扫描所有账号，归档同一用户、同一类型、同一资源的历史重复记录，并同步修正画布、历史快照和项目素材引用。
- 数据保护：新增活动媒体资源唯一索引，作为客户端和服务端的最终防重边界，避免后续版本再次产生重复素材。

## v2.1.3-aicyld.55

- 画布性能：画布路由主 chunk 从约 730KB gzip 降到约 279KB gzip；编辑器对话框、工作流、Cytoscape、Leafer 覆盖层和媒体面板改为按需或空闲加载，并增加前端体积门禁。
- 操作回执：大体积 Agent 操作结果使用透明 gzip 压缩，降低 SQLite、备份和读取放大；新增用户/操作/状态复合索引，消除后台清理慢查询。
- 运维备份：用户资源改为内容寻址共享对象，跨日复用未变化资源；历史 Web hash 文件和旧回滚目录按保留策略自动清理。

## v2.1.3-aicyld.54

- 画布保存：服务端确认保存后，如果本地内容已与确认快照一致，立即清理冗余防抖定时器，避免保存成功后仍短暂显示未保存。
- 发布流程：AICYLD tag 的容器镜像构建优先使用 `RELEASE_VERSION` 校验版本，修复 tag 与 `VERSION` 不一致导致的工作流失败。
- 测试门禁：修复 Windows 换行导致的更新日志断言失败，并同步画布生命周期浏览器测试到 2 秒保存防抖。

## v2.1.3-aicyld.53

- 画布保存：生成任务的进度轮询不再反复提交整份画布；普通编辑统一做 2 秒防抖，显著减少 revision 增长和保存写放大。
- 保存失败：确定性 4xx 会停止自动重试，顶栏显示真实原因与“重试保存”；429/5xx 等可重试错误仍允许恢复。
- 多标签页：同一画布的保存按标签页串行执行，并在检测到多标签编辑时提示用户，降低并发保存冲突。
- 素材恢复：单张本地图片损坏或被系统清理时只保留该素材的错误状态，不再导致整个素材库消失。
- 生成合并：任务生命周期字段和轮询遥测不再制造假版本冲突，结果仍以真实媒体内容绑定为准。
- 运维日志：操作失败记录 request、trace、actor、canvas、asset、reason 等结构化字段，不记录画布 payload 或提示词。

## v2.1.3-aicyld.52

- 修复本地上传图片在素材记录保存失败后一直停在“100% 正在保存”，导致后续生成无法提交的问题；失败时会明确提示并允许重新选择文件。
- 上传进度 100% 后超过 30 秒仍未完成保存时显示“保存超时”和重新选择文件入口。
- 生成前检查连接素材：仍在 上传/保存或上传失败的素材会直接提示原因，不再无反应或进入报价后静默停止。

## v2.1.3-aicyld.51

- 助手节点配置工具补齐图片数量、质量、透明背景，视频水印、编辑模式，以及音频格式、语速、音高、音量和声音指令参数。
- 时间线工具移除根级 `oneOf`，兼容严格 OpenAI-compatible Schema 端点，避免整组工具被拒绝后助手只能回复文字。
- 助手首个输出超过 12 秒时提示检查系统代理或 VPN，开始输出后提示自动消失。

## v2.1.3-aicyld.50

- 助手完整制作方案以确认时的节点、模型和参数为准；之后修改全局生成设置不再让方案失效。
- 点击已确认方案的“生成”会直接提交已捕获的制作计划；仅当画布内容、节点方案或模型可用性真实变化时才要求重新提案。

## v2.1.3-aicyld.49

- 修复助手生成方案因画布或生成设置已变化而失效时，“生成”按钮仍可点击但没有反应的问题。
- 失效方案现在会明确显示原因，并把操作替换为“让助手重新提方案”；点击后直接发送重新提案请求，不再让用户手动重复输入。

## v2.1.3-aicyld.48

- 首尾帧、全能参考等视频模式严格按用户选择和模型能力执行，连接素材不再自动改写模式。
- 首尾帧模式连接超过 2 张图片、参考视频或不支持的音频时，输入区直接提示具体原因并阻止提交；可调整素材或切换全能参考。
- 全能参考模式允许仅连接 1 张图片，并按参考生成提交；无素材或超过模型限制时显示明确提示。

## v2.1.3-aicyld.47

- 视频节点恢复“首尾帧 / 全能参考”模式切换器；即使尚未连接素材，也会按模型能力展示。
- 视频生成模式以用户选择为准：连接图片、视频或角色卡只做兼容性校验，不再自动改写用户选中的模式。
- 补充视频模式回归测试，覆盖无引用、多图、单图、参考视频以及显式模式透传。

## v2.1.3-aicyld.46

- 视频生成：节点关闭声音、指定画幅和分辨率后会真正送达上游；助手可以直接设置视频分辨率，并在写草稿前按模型目录校验。
- 文本接口与本地安全：文本请求只按选定接口发送一次，退役接口不再作为新选项；客户端登记与本地凭据收紧为仅当前用户可读，并清理无引用旧插件包。
- 内置助手：升级 pi 1.5.0，按会话启用提示词缓存亲和，改善长对话的缓存命中、恢复语义和成本控制。
- 画布与外部 Agent：新增 `canvas.create`、创建回执与撤销；旧画布缺失节点、连线或视口时自动归一，避免保存失败。
- 验收：加入真实生成 E2E、S8–S11 失败场景和外部 Agent 对照评测，覆盖分镜、首帧、视频和成片链路。

## Unreleased

- Canvas references: dragging a connection now inserts the same `@reference` token as pick-connect/Alt-click, so a connected resource no longer leaves the generation button grey solely because the prompt stayed empty.
- Skills: hosted deployments no longer expose the server's shared `~/.agents/skills` directory; the local skill source remains available only in the desktop runtime.
- Canvas interaction: insert references at the caret, double-click previews, pick-connect/Alt connection, Alt-drag duplication, and multi-select batch downloads.
- Assets and scripts: MP3 upload, generated-prompt copy, and `.docx/.txt/.md` script import for script nodes.
- Assistant and timeline: session deletion, voice preview, reliable tail-frame concat, and cancellation before task identity is assigned.
- Skills: remove per-file and file-count limits while keeping a 200 MB package guard; optionally sync `~/.agents/skills`.

## v2.1.3

- 生成任务与素材处理：修正媒体错误分类并保留 TaskID，非视频任务不再执行 Seedance 预上传，参考素材链接统一走 URL 安全校验。
- 模型参数：Seedance 2.0 Fast/Mini 仅保留 480p/720p，默认优先 720p；Seedream 未显式选择时默认关闭水印。
- 画布容量与保存：单画布默认上限提升至 64 MB，管理员可在 0–512 MB 范围调整，普通用户只读；加入保存自愈、轮询假冲突修复和 IndexedDB 项目封面迁移。
- 性能与稳定性：GORM 启用参数化查询，降低大画布保存时的 SQL 转义与慢日志开销。
- 技能市场：筛选区滚动吸顶，单页分类隐藏无意义分页，分类数量变化时自动收敛页码。

## v2.1.2

- 画布视频预览、取帧与参考素材上传：浏览器解码失败的视频在播放与自动首帧生成时均支持按需转码 H.264（yuv420p）兼容副本，修复提取首尾帧黑屏与视频节点一直无预览图的问题；延长本地文件上传确认等待并忽略已取消请求，消除大视频入库与切换画布时的误报；本地媒体文件缺失时返回明确 404 且不写入缓存头。
- 项目与画布备份导出：项目列表卡片、文件夹菜单、画布顶栏菜单与保存状态弹窗新增「导出项目」「导出当前画布」「导出文件夹」入口；支持自动跳过已丢失或损坏的历史素材与画板并在备份清单中记录，确保有效画布与素材完整打包并可导入恢复。
- Seedance 2.5 与生成任务体验：补齐 Seedance 2.5 样片转高清成片、输出尾帧开关、视频二创模型选择与图片反推提示词入口；识别渠道分组排除等权限错误码并保留上游非 2xx 响应详情，避免误报为通用网络错误；修复生成完成绑定后节点残留运行态与配置脱敏恢复问题。
- 内置助手与分镜工作流：统一镜头提示词草稿、分镜表联动同步与仅建分镜模式；支持生成单三档审批模式与后台一次建单，生成完成后自动唤醒助手审片；进一步精简助手系统提示词与工具定义，免除重复重读画布；默认挂载漫剧创作三技能。
- 跨端协同与画布性能：顶栏显示外部改动来源与摘要，支持定位改动节点与一键撤销；修复本地过期画布缓存覆盖新版本的问题；降低视频提示词面板与缩放手势期间的渲染开销；支持 BytePlus 亚太控制面及音视频参考素材上传。

注意：部分影音理解、字幕和助手成片排版仍需结合原素材人工核对。

## v2.1.1

- 视频与图片生成新能力：Seedance 2.5 支持先生成 480P 样片预览构图与动作，满意后一键从样片转高清成片；画布新增视频延长、视频局部重绘、反推提示词、输出尾帧，以及图片连续组图生成。
- 内置助手更快更省额度：重构系统指令与技能目录前缀，将画布动态摘要与计划移至请求末尾，多轮对话与工具调用的提示词缓存命中率大幅提升；内置「lucky加一」漫剧创作三技能（剧本拆解、角色设定、分镜提示词），并修复跨通道流式响应的稳定性。
- 打开画布与后台同步更稳：打开画布时已有成品的图片和视频节点保持原有尺寸与位置，不再被默认最小尺寸放大挪位；未匹配节点的后台任务在画布未改动前不再每 5 秒重复尝试绑定，删除画布后自动跳过并在恢复画布后续接，显著降低后台耗电与日志刷新。
- 外部 Agent（MCP）体验升级：默认只暴露常用业务操作，底层操作收敛为查询列表与执行调用两个统一入口，大幅减少外部工具上下文占用；看图工具直接返回图片内容供外部 Agent 审片。
- 渠道与协议兼容性：识别视频云端转存等待状态并自动跟随对象存储重定向；Seedream 4.5 支持选择输出图片格式；移除 Agnes 2.5、MiniMax H3 与客户端提示词长度硬编码拦截，修复自定义渠道能力判断与可灵（Kling）官方接口鉴权。

注意：部分影音理解、字幕和助手成片排版仍需结合原素材人工核对。

## v2.1.0

- 桌面自动更新更快更稳：支持增量更新包（`.delta.zip`）与二进制差分补丁，未变动的运行时与插件直接本机校验复用，常规升级下载体积大幅缩小；增量不可用或校验不符时自动回退完整包。
- 国内更新下载优先连接国内源（CNB），并与 Cloudflare R2 双源互备：遇到连接超时或低速时自动切换另一源并从已下载字节继续续传，最终统一校验文件哈希与 Ed25519 签名。
- 生成参数与参考素材统一由服务端校验：使用自定义渠道（BYOK）或服务端未下发能力声明的模型时，不再在客户端提前拦下请求、隐藏参数控件、置灰模型或自动删减已挂载的参考素材。
- 修复画布节点发送按钮偶发卡在加载状态点不动的问题：待取回或报错节点不再误判为生成中，底部直接显示「继续取回」「重新检查状态」等恢复入口；因本地节点状态无法直接重发时，在输入框上方持久提示具体原因。
- 技能与设置界面：导入技能优先展示中文标题并规范截断超长名称与简介；修复设置页密码输入框出现双层边框、高度不一致的问题。

注意：部分影音理解、字幕和助手成片排版仍需结合原素材人工核对。

## v2.0.6

- 生成结果取回更稳：用 BeefTV 账号生成的图片、视频，结果先保存在云端再直接下载，大尺寸 Seedream 图片和视频不再因下载中断取不回；参考图直接上传到云端，不再经过接口转发。
- 生成中途退出、刷新或断网后，重新打开画布会接着原任务取回结果，不重新提交，也不重复扣费；视频和 AI 超分也能在后台继续取回已经生成的结果。
- 失败节点按服务端给出的结论显示：原任务确定失败时可以直接重新生成，不再一直停在「继续取回」；用 BeefTV 账号提交后若查不到原记录，点击「继续取回」会用原编号补交一次（不重复扣费），原任务还在执行时会自动放回画布，超过保留期仍无法确认则解锁节点。
- 视频模型的时长、分辨率等选项跟随线上模型目录，新模型上线后刷新模型列表即可使用。
- 参考图片支持 TIFF、AVIF、HEIC；扩展名是 .png、实际是 AVIF 或 HEIC 的图片会自动转成 PNG；格式不支持时提示是第几张参考图。
- 自定义模型：开启「减少动态效果」时也能正常选择模型类型；已添加的模型可以在列表里直接改类型；保存时缺少请求协议，会自动打开这个模型的协议设置；同一渠道新加的同类视频模型沿用已选的协议。
- 局部重绘在浅色主题下文字和按钮清楚可读。
- 剪辑时间线：把第一段拖过下一段的中间会交换顺序，只拖一点仍由后面的片段让位。
- 深度动作捕捉的结果视频补到 30 帧，Windows 上也生效。
- 在线更新解压更快，Windows 上文件很多时不再超时。
- 自带 Key 的 Seedream、Gemini、即梦、OpenAI Images 和 Grok 图片渠道改由官方协议插件执行；插件停用时会在生成前提示。

注意：部分影音理解、字幕和助手成片排版仍需结合原素材人工核对。

## v2.0.5

- 内置助手支持查看模型返回的可读思考，默认折叠，与工具进度和回复正文分开；复制回复仍只复制正文。正文继续随模型返回逐段显示。
- 新用户首次连接后，内置助手默认使用 DeepSeek V4.1 Flash；已经选过模型的用户保持原选择，刷新目录、重新授权和换账号都不会自动改掉。
- 改善 Mac 画布平移与缩放的流畅度，减少手势期间的模糊效果、连线装饰、整页重绘和节点反复挂载；修复恢复保存视角后平移时部分节点漏画的问题。
- 剪辑时间线的首个片段可以拖动并让同轨片段让位；单个素材载入失败时点名提示，其他片段继续预览。
- Seedream 图片尺寸按具体型号校验，修正国内 Pro、Flash 型号识别；不支持的尺寸会在生成前给出可操作的提示。
- 部分失败图片任务可在后台继续取回已有结果并保存回画布。本次改动限于图片恢复，不包含完整的视频、超分自动恢复流程。
- 手动添加模型时，需要明确选择图片、视频或文本等类型，不再默认选中文本；添加下一个模型时重新选择，避免沿用错误类型。
- Topaz 超分说明改为本次先扣费用上限、账单核对完成后按实际用量结算，不再把预扣总额显示成单价。
- 模型服务设置按协议写清所需凭证，混用不同凭证时提示拆成独立连接；读不到模型列表时，可以手填模型 ID 继续配置。
- 修正即梦官方视频的成功判断与请求参数，以及 Runway、Luma、Grok 视频结果的取回；参考素材按所选模型的能力检查。
- 有待取回视频时，也能正常安装兼容的协议修复；Luma 和 Runway 的旧任务继续使用原任务编号取回结果，无需重新生成。
- 更新已停止提供视频服务的官方连接预设；仍被现有连接或未完成任务使用的协议定义会保留。

注意：部分影音理解、字幕和助手成片排版仍需结合原素材人工核对。模型没有返回可读思考时，不会凭空显示思考内容；流式显示速度仍取决于模型返回速度。

## v2.0.4

- 大画布（几十到几百个节点）缩放和平移改为远景缩略图渲染：远景下所有节点仍然可见，放大后自动回到完整卡片，明显减少卡顿和闪烁。
- 拖动节点只更新相关连线，减少整页重绘；助手发起操作前先等画布保存完成，遇到版本冲突会暂停这一批写入并重新读取，避免重放过期操作。
- 生成结果已经保存、画布却还停在加载或报错状态时，改为显示已保存的结果；生成前检查失败的原因持续显示在生成面板，下次准备时再清除。
- 参考素材上限改为按类型分别限制：图片、视频、音频各自按模型能力配置限量，不再用一个合计数字挡住后面的添加；超限提示直接显示在参考内容面板，并写清是哪一类、当前数量和上限。
- 参考音频与输出时长按官方文档核对：Seedance 参考音频单段最短 2 秒、输出时长最短 4 秒；被拦下时会写清哪一项、现在多少、要改成多少。
- 第三方图片渠道的响应格式（response_format）可以选择 b64_json 或 url，前端直连、后端内置请求和官方 OpenAI Images 插件三条路径都会按配置发送。
- 画布外观新增「滚轮操作」，可固定为缩放或平移，不再只靠设备步长猜测（默认仍是自动）；提示词里手写的角色名和素材标题保留原文，「一键引用」与 @ 只把素材引用追加在后面。
- 生成不再替换节点已有的名称：从文本节点发起生成时，你自己起的名字保持不变，只有节点还是默认名时才按提示词命名。
- 新建节点按记住的参数选择同名模型组里的兼容型号，图片和视频节点的上次参数继续记忆；修复新建个人素材分类后的显示与选中，以及 COS/OSS 端点重复拼接存储桶的问题。
- 创作助手可以读取只保存了资源地址的图片节点；静态图片按原始像素发送，长图和小字不再被压缩丢失，并可按原始像素查看局部细节。
- 修复上游已明确拒绝图片输入时画布显示「提交结果不确定」并挡住修改后重试的问题；桌面端恢复本地超时策略；外部 MCP/CLI 的生成提交不再要求内置助手的确认回合。
- 创作助手的付费提交必须持有确认卡片写入的有限授权，后续模型调用不能把未确认的方案提升为授权；确认卡片显示视频镜头与费用估算，未报价的图片和配音明确另行计费。
- Windows 下调用 FFmpeg/ffprobe 不再弹出控制台窗口。

注意：影音模型仍可能漏报剪点或写错同音词，字幕与画面需结合原片核对；助手成片的角标排版和局部文字修改仍需人工检查。「上游已生成、画布拉不到成片」的自动取回改动仍在复查，不在本版。

## v2.0.3

- 视频提示词改为按所选模型与接口校验长度，移除通用 8000 字符默认拦截，不自动截断提示词。
- 新插入的参考素材引用跟随具体素材，调整连线后仍对应原图；改善 Seedance 全能参考中的人物与素材对应关系。
- 修复素材栏引用按钮点击无效的问题；素材表与实际引用矛盾时，在生成前提示。
- 失败视频重试使用原任务保存的提示词、素材和参数；如需使用后来修改的内容，请从节点的生成入口新建请求。进行中或已完成的任务继续取回已有结果。
- 延长超分报价、创建和恢复请求的等待时间，改善网络超时和源文件不可用时的提示。

注意：旧提示词中的手写编号保持原顺序；已有自定义字数上限仍然生效，可在模型设置中恢复默认限制。人物服装、发型等生成细节仍可能不稳定。

## v2.0.2

- 支持已配置 Seedream 渠道的图层拆分和关联组图，生成结果分别保存到画布。
- 修复助手生成多图后无法检查结果的问题；整片制作暂不支持图层拆分或组图，会在生成前提示。
- 改善创作助手的任务恢复、停止与进度显示，修复读取当前画布和选择审片素材的问题。
- 参考图上传遇到临时故障时有限重试，中断后继续原上传记录。
- 修复部分外接视频渠道的多图请求，以及临时 DNS 错误导致的任务查询中断。
- 助手宽表格可在侧栏内横向滚动。
- 修复 Windows 已运行 BeefTV 时再次打开技能安装链接失败的问题；链接仍只打开指定版本的安装确认页。

已知限制：影音模型仍可能漏报剪点或写错同音词，字幕与画面需结合原片核对；助手成片的角标排版和局部文字修改仍需人工检查。

## v2.0.1

- 新增可复用的画布工作流，可编辑模板、绑定输入、选择多图结果并执行媒体处理；内置账号支持 Topaz 图片和视频超分。
- 修复任务恢复时的画布更新丢失、多图生成数量匹配和工作流取消后的任务核对，保留已生成结果与后续编辑。
- 诊断包补充跨启动记录、助手执行和素材检查，支持通过 CLI 离线分析；修复助手退出时的授权错误及跨域请求问题。
- 技能市场支持固定版本安装、文件查看、启停、回退和私人改写；作者可在客户端继续草稿，分别确认私有上传和公开送审。
- 技能链接打开指定版本的安装确认页，并显示审核摘要；文字技能无需配置多模态模型。
- 新版安装包和自动更新改用 Cloudflare R2 下载源，旧客户端保留更新入口，继续校验签名和完整文件。

已知限制：影音模型仍可能漏报剪点或写错同音词，字幕与画面需结合原片核对；助手成片的角标排版和仅修改片尾文字仍需人工检查。

## v2.0.0

- 内置助手可准备分镜、整理参考素材和生成方案，在确认后继续检查结果、剪辑和导出成片及可编辑工程。
- 新增默认多模态模型选择，用于影音审查；未配置时仍可使用其他创作工具，并明确提示无法完成的媒体检查。
- 增加参考素材读取、独立影音检查与局部修改工具，保存检查记录，便于核对结果和继续编辑。
- 技能市场支持浏览和安装固定版本；可通过网页、CLI 或外部助手准备投稿，上传和公开送审分别确认。
- 大参考素材支持分片上传和中断后继续，上传、下载、校验和保存分别显示进度。
- 修复生成结果回到画布、旧节点占用和重复下载问题；大画布导出使用原生保存入口。
- 改善剪辑预览、低帧率视频回放和竖版字幕，更新项目许可入口与第三方许可、源码说明。

已知限制：影音模型仍可能漏报剪点或写错同音词，字幕与画面需结合原片核对；助手成片的角标排版和仅修改片尾文字仍在继续验证。

## v1.7.27

- Music 3.0 默认生成 44.1 kHz、256 kbps 的 MP3；设置仅展示实际支持的格式，已有 FLAC 设置自动调整为 MP3。
- 企业音乐生成期间持续保持连接，收到完整音频后再保存；连接中断或错误内容不会被当作生成成功，也不会自动重复生成。
- 桌面更新清单和安装包使用广州 COS 下载源，安装前继续校验签名、文件大小和哈希。

## v1.7.26

- 修复开启“减少动态效果”时，删除模型渠道的确认框无法显示的问题。
- 参考图片上传失败时，准确说明本次尚未开始生成，允许稍后主动重试。
- 提交结果仍未知的任务继续保留原记录，避免把查询或取回变成重复生成。
- 深度捕捉组件下载前显示大小并等待确认，优先使用国内下载源，停顿时切换备用源；重启后由用户决定是否继续任务。
- 存储设置集中管理深度组件与参考素材对象存储，支持测试上传、读取和清理；自定义渠道可选择参考素材的传输方式。
- Midjourney 每次生成固定四张图片，四张结果分别保存，重新打开画布仍可查看。

## v1.7.25

- 生成前保存完整参数和参考素材；提交结果不确定时先查询原任务，避免重复生成。已完成结果可继续取回，并限制同时下载数量。
- 优化画布对象命名、参考素材选择和视频设置；参考视频缩略图按需加载，减少大量素材时的等待与内存占用。
- 修复模型菜单定位、明暗主题对比和提示词字号设置；环境自检补充浏览器存储与运行环境检查，诊断内容按账号隔离。
- GPT Image 2.5 开放完整质量与尺寸选项，默认使用低质量档位；成功图片可恢复原图下载，避免未完成回执覆盖结果。
- 支持连接本机及局域网模型服务，并在未设置代理环境变量时继续使用系统代理设置。
- 修复国内视频参数与水印设置，更新对象存储依赖；桌面包补齐媒体探测工具，macOS 安装镜像改进挂载兼容性。

## v1.7.24

- 修复视频未预载时长时「截取尾帧」退化为首帧的问题，解码失败自动回退拉取 H.264 播放副本并弹出截取完成提示；Windows 桌面端启用原生暗色标题栏与深色启动底色。
- 侧栏新增「更新失败排查」，支持打开日志文件夹并在诊断包中导出脱敏的 `update.log` 摘要；准备安装超时区分校验、解压和准备安装阶段。
- 历史媒体入库期间保留用户对画布节点和时间线的并发增删改；修复旧版桌面 WebView 打开画布时因数组方法兼容问题崩溃。
- 外接视频模型需显式选择协议，Sora 协议在提交前提示不支持的多素材限制，新增可复用的 JSON 视频协议；支持 BytePlus 渠道自动识别火山方舟协议与 Dreamina 视频编辑、续写和自动时长。
- H3 首尾帧、角色多视图与 Styles 模式明确比例限制提示；收起 H3 Max 中间帧入口并保留历史残留参数的清理按钮。
- 区分本机凭据错误与磁盘空间不足报错，区分请求尚未发出与提交结果未确认（409），断点续传仅在强校验匹配时复用缓存字节。

## v1.7.23

- 修复画布内旧版未入库媒体节点拦截新生成结果回写，以及点击「继续取回」闪一下又退回报错的问题；生成完成或继续取回时自动补齐画布素材绑定。
- Windows 安装向导简化为一键安装，默认创建桌面快捷方式并在完成后打开软件；直写目标目录消除杀毒软件扫描临时目录导致的“错误 32”，支持直接选盘符根目录、自动关闭运行中的旧版进程，并修复安装界面中文乱码。

## v1.7.22

- 所有视频渠道统一优先取回上游结果；下载中断或链接失效时刷新原任务链接，内置 BeefAPI 还可切换备用文件，无需重新生成。
- 修复工作流多个结果在链接更新后取错素材的问题，并按实际文件识别视频、图片和音频。
- H3 Max、Max Turbo 的时长输入支持小数秒，H3 Max 支持中间帧与参考顺序设置；修复高级设置菜单被弹层遮挡的问题。

## v1.7.21

- 视频生成完成后优先下载上游结果，减少取回等待；下载失败时自动取回同一视频的备用文件，不重新生成。
- 下载中断或长时间没有进展时及时切换备用地址；取消取回会停止当前下载。

## v1.7.20

- 新增 MiniMax H3 和 H3 Max，与 H3 Max Turbo 一起提供人民币报价。
- H3 支持 2K/4K、首尾帧和多图、视频、音频参考；前 5 张参考图免费，超过后显示按张费用。
- 修正 H3 视频请求的画面比例，关键帧视频沿用图片比例。
- 深度动作捕捉等待时间与后端保持一致，重启后恢复原任务；已生成的视频可以继续取回。

## v1.7.19

- 下载更新后只解压一次，并显示校验、保存、解压和准备安装的进度。失败时能看到原因，可以重试。
- 更新前不再把以前导入失败留下的记录当成还没保存。保存失败时可以返回处理、再试一次，或确认后继续更新；继续更新可能丢掉还没保存的修改。
- Windows 安装时如果目录被占用，会自动重试，并显示中文说明和错误码。安装失败时会尽量恢复原来的程序。
- 开启「减少动态效果」后，默认模型菜单会留在屏幕内，可以正常打开和选择。

## v1.7.18

- 新增 MiniMax H3 Max Turbo 视频模型，支持 480p、768p、1080p，显示当前人民币秒价。
- 支持首尾帧、仅尾帧和指定配音；生成结果沿用画布保存与原任务恢复。

## v1.7.17

- 修复 macOS 视频播放器点击全屏无反应的问题。
- 生成结果取回时显示进度、大小和速度，视频生成完成后的下载也会显示；下载中断会自动重试，「继续取回」不会重新生成或再次扣费。
- 结果下载完成后才放回画布，并且只更新相关节点，不会覆盖其他编辑。
- 结果长时间无法写入画布时会结束等待并提示继续取回，不再一直转圈；已生成结果的后台下载支持停止与继续。
- 批量出图时，排队等待不再消耗自动重试次数，只有真正发出的请求才计数。
- 修复 BeefAPI 视频模型被当作文本模型调用而报错的问题；模型很多时设置页和下拉不再卡顿。
- 修复部分 BeefAPI 图片模型因旧协议配置从出图列表消失的问题。
- 诊断包补齐漏掉的任务记录，并附带脱敏的模型配置摘要，便于排查默认模型和渠道删除问题。
- 画布列表、编辑器和文件夹中的删除操作都会先确认。
- 首页新增新手引导，创作入口增加「3D 导演台」和「Beef Agent」。
- 改进字幕与时间线编辑、素材分类与批量操作、模型目录刷新，以及桌面更新失败后的恢复。
- Windows 安装包可以选择安装位置；临时文件被占用时不再阻止存储迁移。
- 内置助手的旧会话保留为只读记录，继续发送消息会自动开启新会话并接上之前的内容。
- 旧会话接续后即使首轮失败、断线或重启，也会复用同一条接续会话并保留上下文。

## v1.7.16

- 音频和视频节点的字幕窗口支持云端自动转写，可读取已连接 BeefTV 账号的转写模型。
- 支持 hy-asr-3.0-preview，识别结果可编辑、保存到画布并导出 SRT；保留本地 whisper.cpp 转写。
- 转写模型与配音、音乐生成模型分开显示，避免使用不匹配的接口。
- 云端转写中断且结果不确定时不自动重复提交，避免重复计费。

## v1.7.15

- 调整工作区侧栏、画布工具与素材面板，保留主题、更新和帮助入口。
- 删除生成中节点时增加确认；切换画布或账号后，旧确认不会误删其他画布内容。
- 版本记录保留本机草稿，可预览和下载；恢复历史版本前先保留当前草稿。
- 修复素材引用菜单意外关闭、点击穿透与键盘导航问题。
- 历史视频仅在悬停或聚焦时加载预览，离开后取消下载。
- Windows 随包提供视频转码工具；无法直接播放的视频按需准备兼容预览，保留原件。
- 改善国内网络下的视频结果取回；正常线路失败后读取同一任务的备用接口，无需重新生成。
- 修复 Windows 连接、画布媒体和滚轮交互问题。
- 新增 Ubuntu 24.04 x64 桌面包，支持随包 CLI 和 MCP。

## v1.7.14

- 兼容通道的助手回复长时间没有新内容时自动尝试恢复，保留已完成操作，仍可随时停止。
- 视频节点自动显示首帧时不再改动画布，避免已准备的生成方案因此过期。
- 修复画布上按 Backspace 意外离开，以及离开或切换画布时删除内容未及时保存的问题。
- 生成方案显示未能开始的具体原因与等待状态；长任务显示已等待时间。
- 同轮多次局部编辑按各画布接续版本，恢复时保留原操作身份；外部删除与本地编辑冲突时保留本地内容并提示处理。
- 修复大画布读取被截断的问题，助手可分页读取完整节点、连线和时间线。
- 修复切换助手模型后仍使用旧模型的问题；恢复未完成轮次时继续使用原模型。
- 修复完全访问模式下工作区画布搜索错误过滤，导致找不到其他画布的问题。
- 旁白剪辑可检测实际停顿，并再次听取裁剪后的音频核对尾字与保留内容。
- 修复素材读取补齐资源后已成功，助手仍显示先前失败提示的问题。
- 删除素材记录时保留画布和历史仍在使用的资源，避免影响已有作品。
- 模型配置支持搜索选择，保留自定义服务和暂不可用的模型设置。
- 改进 BeefTV MCP 的连接状态和管理入口、侧栏收起与社交入口，并提供应用内中文更新说明。

## v1.7.13

- 连接入口改为「连接 BeefTV」，新登录授权和钱包控制台使用 beeftv.app；保留已连接企业账号。
- 创作助手支持图片、视频和音频参考、运行中补充内容与固定版本技能，并使用持久会话恢复中断工作。
- 助手可将已上传素材绑定到画布参考节点；技能选择器支持直接安装 ZIP 和 Markdown 技能。
- 内置助手可选择只读、当前画布或完全访问；跨画布编辑可整轮撤销。
- 切换助手权限后仍可读取已授权的会话素材；修复多图再次生成时新结果被旧画布覆盖的问题。
- 助手可裁剪、排列素材，添加旁白和字幕，并在本地渲染视频预览。
- 助手对话直接显示成片版本，可播放、下载，并在重开对话后恢复。
- 模型回复失败时保留已完成操作，提供继续处理入口。
- 外部 Agent 通过 MCP／CLI 使用完整业务工具，无需在 BeefTV 重复选择执行权限。
- 补齐节点移动、删除、移除连线和模型目录；修复失败更新留下安装缓存的问题。

## v1.7.12

- Seedance 2.0、2.5 统一名称，模型列表不再重复展示真人素材型号。
- 模型选择和助手生成确认显示当前报价。
- 保留旧项目的模型设置，仍可继续使用。

## v1.7.11

- 图片生成前先保存画布节点，保存冲突时停止提交，避免生成完成后找不到结果节点。
- 图片已生成但画布更新失败时保留原任务，可重新加载资源，无需再次生成。
- 修复桌面端“重新加载资源”不可用，以及恢复任务后一直显示生成中的问题。

## v1.7.10

- 真人视频模型统一显示为 Seedance 2.0-真人、Seedance 2.5-真人，模型选择、设置和名称搜索保持一致。
- API 模型 ID、价格与渠道路由保持不变。

## v1.7.9

- 新增 Seedance 2.0、2.5 真人素材版，选择模型时显示价格，标准版保留原价。
- 修复模型目录刷新、分镜工作台恢复设置时可能自动切换到不同收费档位的问题。
- 生成与重试前检查真人素材版的可用状态和报价，助手确认卡片同步显示单价。

## v1.7.8

- 修复部分视频点击预览后页面崩溃、无法播放的问题。
- 修复恢复设置时已关闭的视频声音开关被重新开启的问题。
- 修复 Windows 下载更新包后无法完成校验的问题。

## v1.7.7

- 生成前检查渠道能否读取参考素材，需要在线链接时可直接填写并继续生成，或切换渠道。
- 处理参考素材时显示准备阶段，完成后再提交生成任务。
- 修复部分视频渠道的音频、水印等开关参数导致任务无法解析的问题。

## v1.7.6

- 统一素材库、生成历史与画布素材选择的布局，改进窄窗口显示和应用加载画面。
- 上传素材后切换页面仍会完成上传，返回页面不会重复创建素材。
- 永久删除生成历史前增加确认，批量删除失败的项目可单独重试。
- 提供旧回收站素材恢复入口，保留此前归档的素材。
- 改进素材详情中的图片缩放与视频播放控件。

## v1.7.5

- 桌面更新支持断点续传与自动重试，显示下载进度、速度和剩余时间，并提供更明确的网络错误提示。
- 修复桌面端资产详情中的音视频无法播放：通过本地资源鉴权后读取媒体，重启后仍可播放已保存的作品。
- 修复视频生成完成后，相对下载地址被误判为无效地址的问题。
- 新增可由用户配置地址的全参视频协议，支持图片、视频与音频参考素材。
- 改进自定义模型目录的能力识别与加载超时。
- 修复 macOS 保存媒体时改名丢失扩展名的问题。

Windows v1.6.20–v1.6.22 的旧更新器无法识别新版目录结构，请关闭应用后手工解压新版完整安装包；保留原用户数据目录。v1.6.23 及后续版本可使用应用内更新。

## v1.7.3

- Add guided setup for OpenAI, Google Gemini, Volcano Ark and compatible model services, with searchable catalogs and manual model entry.
- Preserve selected models and explicit protocol settings when refreshing custom catalogs.
- Wait for completed generation results during model tests and preserve actionable authentication errors.
- Encrypt local provider settings, backup settings and custom task headers; omit credentials from the browser's persisted configuration cache.
- Require upgrades from released Windows installers and failed-launch rollback tests against the final Windows package before publication.

## v1.7.2

- Restore the bundled Windows MCP command-line tool and prevent MCP connections from accidentally opening another desktop window.
- Add separate Claude Desktop setup instructions and stop offering connections when installation files are incomplete.
- Keep Windows runtime discovery outside AppData so packaged MCP clients cannot reuse an old virtualized runtime file.
- Start the Windows assistant in the background without opening a Node console window.
- Explain blocked model-service addresses and DNS failures with actionable connection guidance.

- Automatically remove completed upgrade folders after the local workspace starts successfully, while preserving failed upgrades for recovery. Windows also removes its released lock file; macOS retains the empty lock for compatibility with older update helpers.

- Fix the canvas assistant being unavailable when following a default text model from a custom local channel.
- Keep explicit model capabilities, protocol restrictions, and channel credentials in effect when resolving assistant connections.

## v1.7.1

- Choose the canvas assistant model directly beside the message input.
- Start with GPT 6 Astra after connecting BeefAPI, and keep your chosen model when refreshing the catalog.
- Offer Astra, Opus 5.5, DeepSeek V4.1 Flash, and GLM 5.3 when available on the connected account.
- Save model changes before starting the next assistant request.

## v1.6.23

- Add a canvas assistant for drafting scenes, editing nodes, connecting references, and proposing image or video generation for confirmation.
- Keep assistant conversations and canvas changes recoverable across restarts, with conflict checks and per-turn undo.
- Let external agents connect through the bundled CLI and MCP using revocable read-only or read-write access.
- Share canvas operations and generation delivery across manual editing and agents, preserving original tasks during recovery.
- Unify media rendering and workspace backup paths while retaining existing projects, assets, and tasks.

## v1.6.22

- Add a director workbench for staging objects, cameras, motion paths, and shot previews.
- Keep director references and exported previews attached to the correct scene when switching or closing the workbench.
- Preserve shot prompts, camera motion, and independent paths when editing or duplicating scenes.
- Restore the canvas archive import entry in the project library.

## v1.6.21

- Keep copied media nodes on the canvas when regenerating them, including changing a copied video's resolution.
- Upload local Seedance reference media before generation, supporting large files and validating media limits before submission.
- Preserve reference dimensions and use the same media preparation path for built-in and protocol-based video generation.

## v1.6.20

- Keep media file extensions when saving or renaming downloads in the Windows file dialog, while preserving overwrite confirmation and cancellation.
- Use the actual media format for asset-library downloads, including MOV, SVG, WAV and M4A.

## v1.6.19

- Explain account quota shortages with actionable balance, token and plan guidance.
- Distinguish completed videos that could not be saved from generation failures, directing users to recover the original result without paying again.
- Preserve structured provider errors and request IDs through video creation, polling and manual result recovery.

## v1.6.18

- Continue polling the original video task after Windows socket resets or connection aborts instead of failing immediately.
- Retry interrupted media downloads without submitting a new paid generation, while preserving cancellation and retry limits.
- Explain Windows network disconnects clearly in saved task errors and include native Windows recovery regression checks in desktop releases.

## v1.6.17

- Restore the audio toggle for BeefAPI Seedance models so silent video requests explicitly disable audio.
- Repair missing task diagnostics columns when upgrading from preview databases that reused migration numbers, preserving existing projects and tasks.
- Distinguish local task storage failures from model parameter errors and explain when generation has not been submitted.
- Require two complete rounds of real generation acceptance across six image and video paths before publishing desktop updates.

## v1.6.16

- Recover transient video download disconnects using the original provider task, with bounded background recovery for supported video protocols.
- Add “取回结果” to failed video task details on the canvas and in desktop task history; query and download the original result without creating another paid generation.
- Treat lost submission receipts as unconfirmed instead of silently resubmitting; keep explicit rate limits and pre-dispatch rejections retryable.
- Show readable, sanitized task log summaries and prevent late task detail responses from reopening or replacing a different task.

## v1.6.15

- Preserve specific generation errors, request IDs, timings and bounded request history in copied diagnostics, including after reopening a task.
- Distinguish local input and response-size limits, provider failures, and errors while saving or applying generated results.
- Include task image settings, reference counts and limits without copying prompts, credentials or media addresses; preserve request evidence during background polling and clear it when retrying.

## v1.6.14

- Keep canvas task details up to date with the desktop backend while a task is running, including progress, logs and start/completion times.
- Stop detail polling after completion and cancel pending reads when closing or switching tasks; show a retry notice when details cannot be refreshed.

## v1.6.13

- Accept Windows PowerShell ZIP path separators when installing signed depth components while retaining traversal and duplicate-file protection.
- Use the configured Windows/macOS system proxy for optional depth-component downloads, matching the desktop updater and preserving explicit environment proxy/bypass settings.
- Include Windows x64 depth-video processing from v1.6.12 with signed optional runtimes. CPU inference is tested; NVIDIA CUDA support is a community testing preview with a one-time CPU fallback for device failures. First use downloads components, and CPU processing can be slow and memory intensive.
- Expand the director workspace with scene controls, camera following, aspect frames, screenshots and panorama generation history.
- Preserve director scene covers and task recovery context, and improve canvas crop and trim controls at low zoom.
- Check for desktop updates periodically and support downloading and installing from one action while saving work first.
- Prevent late uploads and screenshots from overwriting reopened director scenes; drain panorama result writers before switching workspaces.
- Stamp director cover and output edits before persistence so refreshed canvases retain their previews.
- Install the matching Chromium browser in CI and tolerate subpixel rounding in model-picker layout checks.

## v1.6.12

- Add Windows x64 depth-video processing with the fixed Small model, signed optional CPU/CUDA runtimes, resumable verified downloads, and process-tree cancellation.
- Validate CUDA with a real model probe and fall back once to CPU for device failures. CUDA hardware support is a community testing preview; CPU inference has been tested on Windows with 2-second and 15-second clips.
- Fix Windows PowerShell 5.1 runtime-builder encoding and align the worker's video-duration limit with the app.
- Serialize component installation and stop download verification and extraction when cancelled.
- First use downloads optional components; CPU processing can be slow and memory intensive. Apple Silicon Mac processing remains unchanged.

## v1.6.11

- Fix local reference images being rejected before submitting Wan 3.0 video tasks through BeefAPI.
- Share verified enterprise video contracts across the model catalog, reference validation, and request preparation; preserve explicit protocols for other models.
- Reject unsupported reference types and counts before submission, and retain actionable media guidance in task history.
- Honor installed protocol media declarations and include the shared contracts in container builds.

## v1.6.10

- Check reference-video frame rates on WhatsToken material-conversion routes, including ordinary, fragmented and mixed MP4 files.
- Explain frame-rate, unsupported-codec and asset-access errors with actionable guidance that survives task history reloads.
- Preserve authentication errors and request identifiers when formatting media errors.

## v1.6.9

- Fix built-in BeefAPI Seedance profiles selecting a package name instead of the installed video provider ID, which caused false "interface not installed" failures before submission.
- Repair existing enterprise profiles automatically and accept previously saved OpenAI Videos protocol aliases without bypassing disabled plugins.
- Verify imported and restored Seedance profiles against the shipped provider catalog and test legacy aliases through the installed plugin runtime.

## v1.6.8

- Read missing reference-video dimensions even when duration is already known, and reject unreadable or out-of-range video before submission.
- Validate local and inline video dimensions from the actual file instead of trusting stale metadata.
- Explain pixel-limit failures with the affected reference, actual dimensions and allowed range.

## v1.6.7

- Ask for confirmation before paid Seedance 2.0 standard and 2.5 reference-video generation on affected channels where the requested aspect ratio may not be honored.
- Show frame, edit and extension settings that follow the source media, and explain first-frame compatibility errors with actionable guidance.
- Preserve generated videos and show a notice when their measured aspect ratio differs from the submitted request.

## v1.6.6

- Preserve structured provider error codes when polling Seedance tasks, so temporary route outages do not ask users to change model settings.

## v1.6.5

- Preserve explicit Seedance 2.5 reference/edit/extend task intent in provider requests.
- Recognize temporary model route unavailability as an actionable provider error.

## v1.6.4

- Restore Seedance image, video and audio references for built-in BeefAPI models after catalog import and configuration reload.
- Migrate the old built-in zero-reference profile while preserving unrelated custom limits, and align Seedance submission with the Videos API.
- Recognize Seedance capabilities for OpenAI Videos model profiles in both frontend and backend validation.

## v1.6.3

- Preserve explicit first/last-frame roles and adaptive aspect ratios for Seedance 2.5, including official model aliases and BeefAPI Enterprise requests.
- Keep reference generation distinct from frame, edit and extension constraints; retain explicitly selected reference and extension modes.
- Add a supported-mode selector to the professional video canvas and explain when output parameters follow input media.
- Explain nested TaskTypeConstraint failures with actionable guidance and retain the same message and diagnostic IDs after task reload.

## v1.6.2

- Retire the unfinished built-in Agent product surface: the canvas dock, creation entry, home capability card, Agent query parameters, Agent settings and the `/agent/*` API are no longer reachable, so partially working Agent flows can no longer be entered by mistake.
- Enforce the retirement at the product boundary: generic task creation, task retry and the task worker refuse `cloud_agent`, `cloud_agent_step` and `agent_memory_compact` work instead of executing it as an ordinary paid text generation, and the periodic Agent memory compaction no longer runs in the background.
- Keep historical Agent runs, profiles, memories and tasks in place with no destructive migration.
- Manual creation and generation keep their existing authorization, quoting, approval, idempotency and cancellation behaviour on the canvas and in the creation workspace; canvas editing and connections, projects, assets, local storage, model channels, the built-in BeefAPI connection and the v1.6.0 depth workflow are unchanged. The retired Agent approval and memory endpoints are removed together with the rest of `/agent/*`.
- Remove the unused local `AgentPort` wiring, the test-only `generation.Engine`/`Deps` wrapper that had no production caller, and the unreferenced experimental `cmd/mcp` stdio entry.
- Simplify the core CI gates to the checks that guard the local product surface.
## v1.6.1

- Explain input and output moderation failures by text, image, video and audio, including copyright, privacy and counterfeit-content restrictions.
- Preserve specific failure guidance and request IDs when reloading task history; avoid attributing general moderation failures to real-person references.
- Distinguish upstream billing problems, configured usage limits, concurrency limits and model permissions, including errors wrapped in generic request codes.
- Keep uncertain submissions and unchanged moderation failures from automatically generating another request.

## v1.6.0

- Add depth action capture to the canvas video-processing menu on Apple Silicon Macs, with an optional local runtime and separately cached Small model weights.
- Download and verify depth components from the BeefTV release, with a Hugging Face fallback for model weights and visible task progress.
- Keep video first-frame posters visible until hover playback presents a decoded frame, preventing black flashes when playback starts or stops.
- Preserve current generation, reference-media, desktop-update, and task-retry contracts while integrating the new workflow.

## v1.5.9

- Validate reference image dimensions, aspect ratios, file sizes and audio/video duration using each model's configured capabilities before submitting.
- Preserve supported reference counts, resolutions and durations instead of silently dropping media or downgrading requested settings.
- Support local and inline reference audio for BeefAPI and native Ark channels, while retaining provider-specific audio-only rules.
- Show actionable reference conversion and request-size errors in both canvas nodes and task history, with safe diagnostics and no unsafe unchanged retries.

## v1.5.8

- Add a persistent light/dark switch to the workspace sidebar, with matching home, asset library, menus and settings surfaces.
- Restore canvas appearance controls with light, dark and custom modes; keep each canvas appearance independent from the workspace theme.
- New canvases follow the workspace theme unless an explicit default appearance is saved.

## v1.5.7

- Desktop update checks and downloads now use Cloudflare-hosted files, preserving signed manifests and package integrity verification.
- Publish immutable platform packages before switching the update feed, with verified downloads and protection against incomplete or older releases.
- Check Seedance reference audio total duration and explain gateway media validation failures with the affected clip and actionable limits.

## v1.5.6

- Validate Seedance reference audio/video duration before submission and preserve duration metadata for character voice samples.
- Explain material conversion failures with actionable duration limits and retain request identifiers for support.
- Keep existing task polling available and prevent unsafe resubmission while provider acceptance is uncertain.

## v1.5.5

- Desktop update checks and downloads now use the current user's static HTTP/HTTPS system proxy on macOS and Windows when no explicit environment proxy is configured.
- Keep a manual update check in the sidebar and show a retry action when checking fails, instead of hiding connection failures.
- Preserve proxy bypass rules, signed manifest verification and package integrity checks throughout redirected downloads.

## v1.5.4

- Generation failures now explain the cause and the next action across canvas nodes, task history and custom channels.
- Distinguish content moderation, account quota, provider billing, invalid parameters, rate limits, uncertain submissions and failed result downloads without guessing refunds or the offending input.
- Preserve safe error codes and request identifiers for support, including business errors returned with HTTP 200 and JSON errors inside media downloads.
- Prevent unsafe unchanged batch retries; edited prompts and reference media can be submitted as new attempts after moderation failures.
- Cover all 42 currently declared BeefAPI error codes with a shared frontend and backend regression contract.
- Improved the shared model picker with a viewport-safe, internally scrollable layout and consistent single-line model options.
- Removed redundant model icons, secondary descriptions, and stale option backgrounds from model selection UI.
- Restored native right-click paste behavior in canvas prompt editors and added regression coverage.
- Added regression coverage for generation output delivery, model picker overflow, and local generation error handling.
- Added a canonical local app update script to keep one installed BeefTV application instead of accumulating duplicate builds.

## v1.5.3

- Desktop builds show the installed version in the sidebar and check for published updates on startup.
- Signed updates can be downloaded in the app, then installed with an explicit restart while keeping local projects, assets, settings and connections.
- Pending canvas, director and timeline saves are checked before restarting; failed downloads or verification leave the current installation intact.
- Maintainers can build and publish signed macOS and Windows update packages from main. Existing installations need one manual upgrade to this version before in-app updates are available.

## v1.5.2

- Improved canvas node rendering and inline image cropping, annotation, and local redraw interactions.
- Rebuilt the recycle bin with a fixed two-row viewport, selection, recovery, and confirmed permanent deletion.
- Fixed project cover selection across media nodes and canvases, including fallbacks and centered empty placeholders.
- Added a short product demo and updated the README branding.

## v1.5.1

- Initial public BeefTV snapshot.
- Local-first AI video workspace with image, video, audio, text, asset, canvas, and model-channel workflows.
- BeefAPI remains a built-in local channel while its model catalog is discovered dynamically.
