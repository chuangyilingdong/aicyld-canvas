# 交付阶段 E2E

验证「两镜视频 → 一键成片 → MP4/SRT 下载」的完整链路。脚本会创建临时短剧项目、上传本地合成视频、登记镜头产物、在真实浏览器里点击成片并校验下载内容，最后删除测试项目。

## 运行要求

- 非生产 AICYLD 测试环境
- 本地 `ffmpeg`
- Playwright 和 Chrome/Chromium
- 若测试环境需要登录，提供 Playwright `storageState` 或持久化 profile

## 环境变量

```powershell
$env:AICYLD_E2E_BASE_URL = "http://127.0.0.1:3000"
$env:AICYLD_E2E_STORAGE_STATE = "C:/path/to/storage-state.json" # 可选
$env:AICYLD_E2E_PROFILE_DIR = "C:/path/to/chrome-profile"       # 可选，优先于 storageState
$env:AICYLD_E2E_OUTPUT_DIR = "output/delivery-e2e"              # 可选
$env:AICYLD_E2E_HEADLESS = "1"                                  # 0 可显示浏览器
bun run test:delivery:e2e
```

脚本默认拒绝 `hb.aicyld.com.cn`。只有显式设置 `AICYLD_E2E_ALLOW_PRODUCTION=1` 才会在生产域名运行；生产账号自动化不应作为常规 CI 用例。

成功后会生成：

- `episode.mp4`
- `episode.srt`
- `delivery-success.png`
- `report.json`

测试项目即使中途失败也会尝试取消任务并删除；若环境本身不可用，仍需人工检查残留项目。
