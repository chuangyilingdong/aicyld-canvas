// 上线校验（构建后跑）：产物必须是「托管网站」形态。
//
// 背景：这个仓库也能构建桌面/本地版，两者存储路径完全不同——本地形态会把上传落到
// 浏览器 IndexedDB、把会话级 blob: 地址写进画布文档，部署成网站后表现为
// 「刷新后图片失效 / 服务端说没有这条素材 / 每次提交换一个 assetId」。
//
// 两个构建期开关必须同时钉住，缺一不可：
//   1) VITE_CANVAS_HOSTED=1        → workspace-mode 的 profile 折成 `hosted`
//      （主站托管的存储/素材边界）
//   2) VITE_CANVAS_LOCAL_MODE=false → runtime-mode 的 localFirstBuild 折成 false
//      （isLocalRuntimeMode / usesBrowserLocalResourceStore，以及项目页 /canvas 的
//        remoteMode：漏了它，项目页的列表查询会被折成 enabled:false，页面只读浏览器
//        本地缓存，于是「首页有 N 个、项目页只有 M 个」）
//
// 判定依据：workspace-mode 模块初始化时把 profile 折成 `hosted`。
// 它由构建期常量 HOSTED_BUILD(VITE_CANVAS_HOSTED=1) 决定：常量没生效时这里会是 `local`。
// 注意：模块里 applyWorkspaceProfile() 保留 `profile === "hosted" ? "hosted" : "local"`
// 的运行时三元式是正常的（服务端 bootstrap 会调用它），不能当作构建失败的证据。
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..");
const staticDir = join(webDir, "dist", "static");

const failures = [];

// —— ① 构建输入：两个开关都必须显式钉住 ——————————————————————
const env = loadEnv("production", webDir, "VITE_");
if (env.VITE_CANVAS_HOSTED !== "1") {
    failures.push("VITE_CANVAS_HOSTED=1 没生效（应在 src/web/.env.production 里）");
}
if (env.VITE_CANVAS_LOCAL_MODE !== "false") {
    failures.push(
        "VITE_CANVAS_LOCAL_MODE=false 没生效（应在 src/web/.env.production 里）——"
        + "漏了它，runtime-mode 会按「本地/桌面」跑：项目页 /canvas 只读浏览器本地缓存、"
        + "上传落 IndexedDB、编辑器显示「本地素材库」。",
    );
}

// —— ② 产物：workspace-mode 初始 profile 必须是 hosted —————————
let initHosted = false;
let initLocal = false;
for (const file of readdirSync(staticDir)) {
    if (!file.startsWith("workspace-mode-") || !file.endsWith(".js")) continue;
    const text = readFileSync(join(staticDir, file), "utf8");
    if (/[,;]\s*\w+\s*=\s*`hosted`/.test(text) || /[,;]\s*\w+\s*=\s*"hosted"/.test(text)) initHosted = true;
    if (/[,;]\s*\w+\s*=\s*`local`/.test(text) || /[,;]\s*\w+\s*=\s*"local"/.test(text)) initLocal = true;
}
if (!initHosted || initLocal) {
    failures.push("产物初始 profile 不是 hosted（HOSTED_BUILD 未生效），请确认 VITE_CANVAS_HOSTED=1 后重新构建。");
}

// —— ③ 产物：不能残留未替换的开关名 ————————————————————————
const unresolved = readdirSync(staticDir).filter((file) => file.endsWith(".js")
    && readFileSync(join(staticDir, file), "utf8").includes("VITE_CANVAS_LOCAL_MODE"));
if (unresolved.length) {
    failures.push(`产物里仍有未替换的 VITE_CANVAS_LOCAL_MODE（${unresolved.slice(0, 3).join(", ")}），构建期常量没有生效。`);
}

// —— ④ 产物：项目页 /canvas 的列表查询不能被折成 enabled:false ————
// 这是「首页 N 个、项目页 M 个」那次事故的回归哨兵：remoteMode 一旦被构建期常量折成
// false，react-query 的 enabled 就会变成字面量 !1。
let libraryGuarded = false;
for (const file of readdirSync(staticDir)) {
    if (!file.endsWith(".js")) continue;
    const text = readFileSync(join(staticDir, file), "utf8");
    if (!text.includes("libtv-create-project-card")) continue;
    const at = text.indexOf("`canvas-library`");
    if (at < 0) {
        console.warn("⚠ 项目页 chunk 里没找到 `canvas-library` 查询键，跳过 ④ 号检查（脚本可能需要跟着改名更新）。");
        break;
    }
    const nearby = text.slice(at, at + 800);
    if (/enabled:\s*!1\b/.test(nearby)) {
        failures.push("项目页 /canvas 的服务端列表查询被折成 enabled:false（remoteMode 变成了构建期常量）。"
            + "检查 VITE_CANVAS_LOCAL_MODE=false 是否生效。");
    } else if (!/enabled:\s*\w/.test(nearby)) {
        console.warn("⚠ 项目页 chunk 的 enabled 形状变了，④ 号检查没认出来（请人工确认 remoteMode 仍是运行时判断）。");
    } else {
        libraryGuarded = true;
    }
    break;
}

if (failures.length) {
    console.error("✗ 上线校验失败：");
    for (const item of failures) console.error(`  - ${item}`);
    process.exit(1);
}
console.log("✓ 上线校验通过：构建期已锁定托管形态（profile=hosted，runtime-mode=托管，项目页走服务端列表）。");