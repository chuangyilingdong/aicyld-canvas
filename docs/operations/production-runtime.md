# AICYLD 生产运行参数

## 拓扑

| 服务 | 生产目录 | unit | 监听方式 |
| --- | --- | --- | --- |
| Canvas 后端 | `/srv/aicyld/canvas` | `aicyld-canvas.service` | `canvas.env` 中的 `CANVAS_BACKEND_ADDR` |
| 主站 | `/srv/aicyld/main-prod` | `aicyld-main.service` | Node 端口由 `.env` 的 `PORT` 控制 |
| 后台 | `/srv/aicyld/admin-prod` | `aicyld-admin.service` | `HOST=127.0.0.1` drop-in + `.env` 的 `PORT` |
| 反向代理 | 主机级 Nginx | `nginx.service` | 对外 HTTPS |
| 回滚包 | `/srv/aicyld/backups` | 定时清理 | Canvas 通过 `/srv/aicyld/canvas/backups` 软链接访问 |

生产主机为约 3.4G 内存的小机器。Canvas 当前 `MemoryMax=1200M`；主站和后台使用仓库中的 unit 模板时分别限制为 1000M 和 512M，三项合计 2.7G，给 Nginx 和系统保留余量。

## 环境变量

只记录变量键名，不在仓库中保存生产值。所有密钥、数据库连接串、对象存储凭据和支付密钥必须保存在 root/aicyld 可读的现场 `.env` 中。

### Canvas

`/srv/aicyld/canvas/canvas.env`：

- 身份与内部鉴权：`AICYLD_SSO_SECRET`、`AICYLD_CANVAS_ADMIN_IDS`、`AICYLD_CANVAS_INTERNAL_TOKEN`、`CANVAS_BILLING_SECRET`
- 服务与跨域：`CANVAS_BACKEND_ADDR`、`CANVAS_BACKEND_DATA_DIR`、`CANVAS_PUBLIC_BASE_URL`、`CANVAS_CORS_ORIGINS`、`BEEFTV_ALLOWED_ORIGINS`、`GIN_MODE`
- 任务与停机：`CANVAS_WORKER_CONCURRENCY`、`CANVAS_CHANNEL_CONCURRENCY`、`CANVAS_SHUTDOWN_TIMEOUT`
- 平台集成：`CANVAS_BILLING_URL`、`BEEFTV_OPS_BASE_URL`、`CANVAS_OFFICIAL_PLUGIN_DIR`、`CANVAS_REGISTRATION_ENABLED`
- OSS：`CANVAS_OSS_ENDPOINT`、`CANVAS_OSS_BUCKET`、`CANVAS_OSS_PATH_PREFIX`、`CANVAS_OSS_LOCAL_RETENTION_HOURS`、`CANVAS_OSS_ACCESS_KEY`、`CANVAS_OSS_SECRET_KEY`

### 主站

`/srv/aicyld/main-prod/.env` 的变量分为：数据库 `DATABASE_URL`；站点与安全 `SITE_URL`、`ADMIN_URL`、`JWT_SECRET`、`ADMIN_SECRET`、`AICYLD_SSO_SECRET`；对象存储 `COS_*`；短信与微信 `ALIYUN_*`、`WECHAT_*`；支付 `WXPAY_*`、`ALIPAY_*`；以及模型网关 `LINGDONG_CODE_*`。

### 后台

`/srv/aicyld/admin-prod/.env` 需要 `DATABASE_URL`、`MAIN_DATABASE_URL`、`MAIN_API_URL`、`MAIN_SITE_URL`、`CANVAS_BASE_URL`、`CANVAS_INTERNAL_TOKEN`、`ADMIN_JWT_SECRET`、`USER_JWT_SECRET`、`ADMIN_SECRET`、`MAIN_ADMIN_SECRET`，以及对象存储、短信和站点地址配置。

## systemd 参数

仓库中的 `deploy/systemd/aicyld-*.service` 是现场 unit 的可审查副本：

- 全部以 `aicyld:aicyld` 运行，禁止提权并隔离临时目录。
- Canvas `RestartSec=3`、停服务超时 180 秒；主站/后台 `RestartSec=5`、停机超时 30 秒。
- Canvas 限制 1200M，主站限制 1000M，后台限制 512M。
- Canvas `LimitNOFILE=65535`，满足任务、SQLite 和长连接并发。
- 后台用 drop-in 固定 `HOST=127.0.0.1`，只通过 Nginx 暴露。

安装或更新模板前先备份现场 unit，再执行：

```bash
systemctl daemon-reload
systemctl restart aicyld-canvas aicyld-main aicyld-admin
systemctl is-active aicyld-canvas aicyld-main aicyld-admin nginx
```

## 发布约束

Canvas 后端必须使用 `CGO_ENABLED=1` 构建。替换生产二进制前先停 `aicyld-canvas`，保留后端、数据库、前端、渠道配置、插件包和前端回滚点，再启动并检查：

```bash
systemctl status aicyld-canvas --no-pager
curl -fsS http://127.0.0.1:${CANVAS_BACKEND_PORT}/api/health
```

健康检查的具体端口以 `canvas.env` 的 `CANVAS_BACKEND_ADDR` 为准，不要照抄文档值。付费生成验收仍按发布门禁单独授权。

## 备份保留

Canvas 备份以 `/srv/aicyld/canvas/backups` 为逻辑路径，实际落到 `/srv/aicyld/backups`。`aicyld-canvas-backup-retention.timer` 每天 04:20 触发，随机延迟最多 15 分钟；先默认 dry-run 核对，再执行 `--apply`。主站/后台的部署回滚目录属于独立的 `/srv/aicyld/backups` 运维资产，不能由只看 Canvas 文件名的规则误删。
