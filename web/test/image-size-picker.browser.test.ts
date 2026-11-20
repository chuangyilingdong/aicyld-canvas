import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/image-size-picker-harness.tsx"],
        target: "browser",
        define: {
            "import.meta.env.DEV": "false",
            "import.meta.env.PROD": "true",
            "import.meta.env.MODE": '"production"',
            "process.env.NODE_ENV": '"production"',
        },
        plugins: [{
            name: "source",
            setup(builder) {
                builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync("../src/" + args.path.slice(2), import.meta.dir) }));
            },
        }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const js = await build.outputs.find((output) => output.path.endsWith(".js"))!.text();
    const componentCss = readFileSync(import.meta.dir + "/../src/components/image-size-picker.css", "utf8");
    const cssPath = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwind({ base: import.meta.dir + "/.." })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === "/harness.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
            if (url.pathname === "/harness.css") return new Response(`${css}\n${componentCss}`, { headers: { "Content-Type": "text/css" } });
            return new Response('<html class="dark"><link rel="stylesheet" href="/harness.css"><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
        },
    });
    const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);

afterAll(async () => { await browser?.close(); server?.stop(true); }, 30000);

async function open(): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 520, height: 760 } });
    await page.goto(server.url.toString());
    await page.getByTestId("saved-quality").waitFor();
    return page;
}

test("switching aspect ratio keeps the selected resolution tier", async () => {
    const page = await open();
    try {
        const picker = page.locator(".image-size-picker").first();
        expect(await page.getByTestId("saved-size").textContent()).toBe("1024x1024");
        expect(await page.getByTestId("saved-quality").textContent()).toBe("high");
        await picker.getByRole("button", { name: "16:9", exact: true }).click();
        expect(await page.getByTestId("saved-size").textContent()).toBe("1824x1024");
        expect(await page.getByTestId("saved-quality").textContent()).toBe("high");
        expect(await picker.getByRole("button", { name: "1K", exact: true }).getAttribute("aria-pressed")).toBe("true");
        expect(await page.getByText("16:9 · 1824 × 1024 px", { exact: true }).count()).toBe(1);
    } finally {
        await page.close();
    }
}, 30000);

test("every aspect ratio exposes one stable selected state and automatic sizing lives in the ratio grid", async () => {
    const page = await open();
    try {
        const ratioGrid = page.locator(".image-size-ratios").first();
        const autoButton = ratioGrid.getByRole("button", { name: "自动尺寸", exact: true });
        expect(await autoButton.count()).toBe(1);
        expect(await page.locator(".image-size-auto").count()).toBe(0);

        for (const ratio of ["3:2", "2:3", "16:9", "9:16", "1:1"]) {
            await ratioGrid.getByRole("button", { name: ratio, exact: true }).click();
            const selected = ratioGrid.locator('button[aria-pressed="true"]');
            expect(await selected.count()).toBe(1);
            expect(await selected.getAttribute("aria-pressed")).toBe("true");
            expect(await selected.evaluate((button) => button.classList.contains("is-selected"))).toBe(true);
            expect(await selected.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe("none");
        }

        await autoButton.click();
        expect(await page.getByTestId("saved-size").textContent()).toBe("auto");
        expect(await autoButton.getAttribute("aria-pressed")).toBe("true");
        expect(await autoButton.evaluate((button) => button.classList.contains("is-selected"))).toBe(true);
        expect(await ratioGrid.locator('button[aria-pressed="true"]').count()).toBe(1);
        expect(await page.getByText("尺寸由模型决定", { exact: true }).count()).toBe(1);
    } finally {
        await page.close();
    }
}, 30000);

test("unselected output formats expose a visible hover state while the selected format remains marked", async () => {
    const page = await open();
    try {
        await page.getByRole("button", { name: "输出格式：GIF", exact: true }).click();
        const listbox = page.getByRole("listbox", { name: "输出格式" });
        const png = listbox.getByRole("option", { name: "PNG" });
        const before = await png.evaluate((button) => getComputedStyle(button).backgroundColor);
        await png.hover();
        await page.waitForFunction((initial) => {
            const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"][aria-selected="false"]')).find((item) => item.textContent?.trim() === "PNG");
            return Boolean(option && getComputedStyle(option).backgroundColor !== initial);
        }, before);
        const after = await png.evaluate((button) => getComputedStyle(button).backgroundColor);
        expect(after).not.toBe(before);
        expect(await listbox.locator('[role="option"][aria-selected="true"]').count()).toBe(1);
        await png.click();
        expect(await page.getByTestId("saved-format").textContent()).toBe("png");
        await listbox.waitFor({ state: "hidden" });
    } finally {
        await page.close();
    }
}, 30000);

test("documented advanced provider parameters keep typed values", async () => {
    const page = await open();
    try {
        const advanced = page.locator("details").filter({ hasText: "高级参数" });
        await advanced.locator("summary").click();
        const thinking = page.getByRole("combobox", { name: "思考强度" });
        expect(await thinking.inputValue()).toBe("high");
        await thinking.selectOption("minimal");
        expect(JSON.parse((await page.getByTestId("saved-advanced").textContent()) || "{}")).toEqual({ thinkingLevel: "minimal" });
        await page.getByRole("spinbutton", { name: "GIF 帧数" }).fill("12");
        expect(JSON.parse((await page.getByTestId("saved-advanced").textContent()) || "{}")).toEqual({ thinkingLevel: "minimal", frameCount: "12" });
    } finally {
        await page.close();
    }
}, 30000);
