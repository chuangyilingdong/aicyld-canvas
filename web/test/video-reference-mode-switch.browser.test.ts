import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const build = await Bun.build({
        entrypoints: [import.meta.dir + "/fixtures/video-reference-mode-switch-harness.tsx"],
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
    const cssPath = import.meta.dir + "/../src/styles/globals.css";
    const css = (await postcss([tailwind({ base: import.meta.dir + "/.." })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
    server = Bun.serve({
        port: 0,
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === "/harness.js") return new Response(js, { headers: { "Content-Type": "application/javascript" } });
            if (url.pathname === "/harness.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
            return new Response('<html class="dark"><link rel="stylesheet" href="/harness.css"><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
        },
    });
    const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path): path is string => Boolean(path && existsSync(path)));
    browser = await chromium.launch({ executablePath, headless: true });
}, 60000);

afterAll(async () => { await browser?.close(); server?.stop(true); }, 30000);

async function open(): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 520, height: 260 } });
    await page.goto(server.url.toString());
    await page.getByRole("button", { name: "首尾帧模式" }).waitFor();
    return page;
}

test("top reference-mode switch changes from all-reference to frames without starting a canvas drag", async () => {
    const page = await open();
    try {
        expect(await page.getByTestId("operation").textContent()).toBe("reference_to_video");
        await page.getByRole("button", { name: "首尾帧模式" }).click();
        expect(await page.getByTestId("operation").textContent()).toBe("image_to_video");
        expect(await page.getByRole("button", { name: "首尾帧模式" }).getAttribute("aria-pressed")).toBe("true");
        expect(await page.evaluate(() => Boolean((window as any).parentMouseDown))).toBe(false);
    } finally {
        await page.close();
    }
}, 30000);
