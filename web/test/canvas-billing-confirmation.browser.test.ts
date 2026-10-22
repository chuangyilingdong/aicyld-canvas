import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/canvas-billing-confirmation-harness.tsx"],
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
            name: "test-source",
            setup(builder) {
                builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            },
        }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    server = Bun.serve({
        port: 0,
        fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/harness.js") return new Response(js, { headers: { "content-type": "application/javascript" } });
            return new Response(`<!doctype html><html><body><div id="root"></div><script type="module">import { mount } from "/harness.js"; mount(document.getElementById("root"));</script></body></html>`, {
                headers: { "content-type": "text/html" },
            });
        },
    });
    browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
    await browser?.close();
    server?.stop(true);
}, 15000);

test("browser confirms a sufficient balance quote and returns accepted", async () => {
    const page = await browser.newPage();
    await page.goto(server.url.toString());
    await page.getByRole("button", { name: "打开确认" }).click();
    await page.locator(".ant-modal-confirm-title").filter({ hasText: "确认测试生成" }).waitFor();
    const content = await page.locator(".ant-modal-confirm-content").innerText();
    expect(content).toContain("12");
    expect(content).toContain("100");
    await page.getByRole("button", { name: "确认测试" }).click();
    expect(await page.getByTestId("result").innerText()).toBe("accepted");
    await page.close();
}, 15000);

test("browser cancels without claiming generation", async () => {
    const page = await browser.newPage();
    await page.goto(server.url.toString());
    await page.getByRole("button", { name: "打开确认" }).click();
    await page.locator(".ant-modal-confirm-title").filter({ hasText: "确认测试生成" }).waitFor();
    await page.locator(".ant-modal-confirm-btns button").first().click();
    expect(await page.getByTestId("result").innerText()).toBe("cancelled");
    await page.close();
}, 15000);

test("browser disables confirmation when the balance is insufficient", async () => {
    const page = await browser.newPage();
    await page.goto(server.url.toString() + "?insufficient");
    await page.getByRole("button", { name: "打开确认" }).click();
    await page.locator(".ant-modal-confirm-title").filter({ hasText: "积分不足" }).waitFor();
    expect(await page.locator(".ant-modal-confirm-btns button").last().isDisabled()).toBe(true);
    await page.locator(".ant-modal-confirm-btns button").first().click();
    expect(await page.getByTestId("result").innerText()).toBe("cancelled");
    await page.close();
}, 15000);
