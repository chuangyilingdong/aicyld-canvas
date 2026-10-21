import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

let browser: Browser;
let server: ReturnType<typeof Bun.serve>;
let scratch = "";

beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "beeftv-low-fps-preview-"));
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=320x180:r=2:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "1", "-an", join(scratch, "low-fps.mp4")]);
    const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "fixtures/timeline-preview-low-fps-harness.tsx")],
        target: "browser",
        define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
        plugins: [{ name: "timeline-preview-low-fps", setup(builder) {
            builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(join(import.meta.dir, "..", "src", args.path.slice(2)), import.meta.dir) }));
            builder.onLoad({ filter: /\.(css|svg|png|jpe?g|gif|webp|woff2?)$/ }, () => ({ contents: "export default ''", loader: "js" }));
        } }],
    });
    if (!build.success) throw new Error(build.logs.join("\n"));
    const script = await build.outputs[0]!.text();
    const video = readFileSync(join(scratch, "low-fps.mp4"));
    server = Bun.serve({ port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/harness.js") return new Response(script, { headers: { "Content-Type": "application/javascript" } });
        if (path === "/low-fps.mp4") return new Response(video, { headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" } });
        return new Response('<div id="root"></div><script type="module" src="/harness.js"></script>', { headers: { "Content-Type": "text/html" } });
    } });
    browser = await chromium.launch({ headless: true });
}, 60000);

afterAll(async () => {
    await browser?.close();
    server?.stop(true);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test("low-fps preview advances without rewinding and replays from the clip start", async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url.toString());
        await page.waitForFunction(() => (window as any).timelineLowFpsFixture?.snapshot().video?.readyState >= 2);
        await page.getByRole("button", { name: "播放预览" }).evaluate(element => (element as HTMLButtonElement).click());
        const samples = await page.evaluate(async () => {
            const rows: any[] = [];
            const started = performance.now();
            while (performance.now() - started < 8000) {
                const snapshot = (window as any).timelineLowFpsFixture.snapshot();
                rows.push(snapshot);
                if (!snapshot.playing && snapshot.playheadMs >= 3900) break;
                await new Promise(resolve => setTimeout(resolve, 40));
            }
            return rows;
        });
        const rewinds = samples.slice(1).flatMap((sample, index) => {
            const prior = samples[index];
            const priorTime = prior.video?.currentTime ?? 0;
            const currentTime = sample.video?.currentTime ?? 0;
            return prior.playing && sample.playing && priorTime - currentTime > 0.12 ? [{ from: priorTime, to: currentTime }] : [];
        });
        const last = samples.at(-1)!;
        expect(samples.some(sample => sample.playheadMs > 1000)).toBe(true);
        expect(rewinds).toEqual([]);
        expect(last.playing).toBe(false);
        expect(last.playheadMs).toBeGreaterThanOrEqual(3900);
        expect(last.video.paused).toBe(true);

        await page.getByRole("button", { name: "播放预览" }).evaluate(element => (element as HTMLButtonElement).click());
        await page.waitForFunction(() => {
            const state = (window as any).timelineLowFpsFixture.snapshot();
            return state.playing && state.playheadMs > 40 && state.playheadMs < 1200 && state.video?.currentTime < 1.2;
        });
        expect((await page.evaluate(() => (window as any).timelineLowFpsFixture.snapshot())).video.ended).toBe(false);
    } finally {
        await page.close();
    }
}, 30000);
