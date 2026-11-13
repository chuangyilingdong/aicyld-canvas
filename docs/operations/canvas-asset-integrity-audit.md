# Canvas 素材完整性审计

`scripts/canvas-asset-integrity-audit.py` 是只读审计工具，用于在发布前后检查活动素材库是否再次出现重复或失效引用。工具不修改数据库、资源文件或 OSS。

## 检查内容

- 同一用户、同一媒体类型是否有多条活动素材引用同一个 `resource:<id>`。
- 不同 Resource 的文件内容是否完全相同。只对文件已存在且大小相同的候选组计算 SHA-256。
- `provider=local` 的 ready 资源是否缺少本地文件。
- 活动媒体素材是否引用了不存在的 Resource。

## 使用

```bash
python3 scripts/canvas-asset-integrity-audit.py \
  --db /srv/aicyld/canvas/data/open_ai_canvas.db \
  --resources /srv/aicyld/canvas/data/resources
```

机器可读输出：

```bash
python3 scripts/canvas-asset-integrity-audit.py \
  --db /srv/aicyld/canvas/data/open_ai_canvas.db \
  --resources /srv/aicyld/canvas/data/resources \
  --json
```

严格模式会把缺文件和孤立素材也视为失败：

```bash
python3 scripts/canvas-asset-integrity-audit.py \
  --db /srv/aicyld/canvas/data/open_ai_canvas.db \
  --resources /srv/aicyld/canvas/data/resources \
  --strict
```

默认只把重复资源或重复内容作为非零退出条件，便于在生产中持续监控并区分历史缺文件遗留。使用 `--strict` 时，`missingResourceFiles` 或 `orphanAssets` 非零也会返回退出码 `1`。

`--limit` 控制每类详情最多打印多少条，默认 `50`；传 `0` 打印全部。摘要字段始终统计完整结果。

## 判定

- `duplicateOk=true`：没有同一 Resource 多素材，也没有同内容多 Resource。
- `integrityOk=true`：没有缺文件或孤立素材。
- `ok=true`：以上两项同时成立。

发现缺文件时先对照 OSS manifest 的 `restorePath`，再决定恢复或归档；不要直接删除资源记录。
