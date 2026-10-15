// 上线校验（构建后跑）：产物必须是「托管网站」形态。
//
// 背景：这个仓库也能构建桌面/本地版，两者存储路径完全不同——本地形态会把上传落到
// 浏览器 IndexedDB、把会话级 blob: 地址写进画布文档，部署成网站后表现为
// 「刷新后图片失效 / 服务端说没有这条素材 / 每次提交换一个 assetId」。
//
// 判定依据只有一个：workspace-mode 模块初始化时把 profile 折成 `hosted`。
// 它由构建期常量 HOSTED_BUILD(VITE_CANVAS_HOSTED=1) 决定：常量没生效时这里会是 `local`。
// 注意：模块里 applyWorkspaceProfile() 保留 `profile === "hosted" ? "hosted" : "local"`
// 的运行时三元式是正常的（服务端 bootstrap 会调用它），不能当作构建失败的证据。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, "..", "dist", "static");

let initHosted = false;
let initLocal = false;
for (const file of readdirSync(staticDir)) {
    if (!file.startsWith("workspace-mode-") || !file.endsWith(".js")) continue;
    const text = readFileSync(join(staticDir, file), "utf8");
    if (/[,;]\s*\w+\s*=\s*`hosted`/.test(text) || /[,;]\s*\w+\s*=\s*"hosted"/.test(text)) initHosted = true;
    if (/[,;]\s*\w+\s*=\s*`local`/.test(text) || /[,;]\s*\w+\s*=\s*"local"/.test(text)) initLocal = true;
}

if (!initHosted || initLocal) {
    console.error("✗ 上线校验失败：产物初始 profile 不是 hosted（HOSTED_BUILD 未生效）。");
    console.error("  请确认 src/web/.env.production 里有 VITE_CANVAS_HOSTED=1，然后重新构建。");
    process.exit(1);
}
console.log("✓ 上线校验通过：构建期已锁定托管形态（初始 profile=hosted）。");
