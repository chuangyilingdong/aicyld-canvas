import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";

import { productCss } from "./fixtures/product-css";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const bundle = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/canvas-node-media-viewer-harness.tsx"],
        target: "browser",
        define: {
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": '"production"',
            "import.meta.env.VITE_CANVAS_LOCAL_MODE": '"true"',
            "import.meta.env.VITE_CANVAS_BACKEND_URL": '"/api"',
            "process.env.NODE_ENV": '"production"',
        },
        plugins: [{
            name: "source",
            setup(builder) {
                builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            },
        }],
    });
    if (!bundle.success) throw new Error(bundle.logs.join("\n"));
    const js = await bundle.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const css = await productCss();
    server = Bun.serve({
        port: 0,
        fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/harness.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
            if (path === "/harness.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
            return new Response('<!doctype html><html><link rel="stylesheet" href="/harness.css"><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
        },
    });
    browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
    await browser?.close();
    server?.stop(true);
});

test("image and video share the media viewer shell, information sidebar and node info handoff", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => (new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort()));
    try {
        await page.goto(server.url.toString());
        const viewer = page.getByRole("dialog", { name: "图片预览：统一预览图片" });
        await viewer.waitFor();
        const sidebar = viewer.getByRole("complementary", { name: "生成信息面板" });
        await sidebar.waitFor();
        expect(await sidebar.innerText()).toContain("统一的图片预览提示词");

        await viewer.getByRole("button", { name: "收起生成信息栏" }).click();
        expect(await sidebar.count()).toBe(0);
        await viewer.getByRole("button", { name: "展开生成信息栏" }).click();
        await sidebar.waitFor();

        await viewer.getByRole("button", { name: "节点信息", exact: true }).click();
        expect(await page.getByTestId("info-node").textContent()).toBe("viewer-node");
        expect(await viewer.count()).toBe(0);

        await page.getByRole("button", { name: "重新打开", exact: true }).click();
        await page.keyboard.press("Escape");
        expect(await page.getByTestId("canvas-node-media-viewer").count()).toBe(0);
        expect(errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 30_000);
