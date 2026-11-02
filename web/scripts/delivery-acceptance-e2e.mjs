#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const baseURL = String(process.env.AICYLD_E2E_BASE_URL || "").trim().replace(/\/+$/, "");
if (!baseURL) throw new Error("缺少 AICYLD_E2E_BASE_URL；请指向非生产测试环境");
const target = new URL(baseURL);
if (target.hostname === "hb.aicyld.com.cn" && process.env.AICYLD_E2E_ALLOW_PRODUCTION !== "1") {
    throw new Error("默认拒绝在生产域名运行交付 E2E；如确需运行，显式设置 AICYLD_E2E_ALLOW_PRODUCTION=1");
}

const storageStatePath = process.env.AICYLD_E2E_STORAGE_STATE || "";
const profileDir = process.env.AICYLD_E2E_PROFILE_DIR || "";
const outputDir = path.resolve(process.env.AICYLD_E2E_OUTPUT_DIR || "output/delivery-e2e");
const headless = process.env.AICYLD_E2E_HEADLESS !== "0";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aicyld-delivery-e2e-"));
const fixturePaths = [1, 2].map((index) => path.join(tmpDir, `shot-${index}.mp4`));
const taskIds = [];
let projectId = "";
let unitId = "";
let browser;
let context;

fs.mkdirSync(outputDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createFixtures() {
    for (const [index, output] of fixturePaths.entries()) {
        const color = index === 0 ? "0x1f6feb" : "0xd97706";
        const frequency = index === 0 ? 440 : 660;
        const result = spawnSync("ffmpeg", [
            "-y", "-v", "error",
            "-f", "lavfi", "-i", `color=c=${color}:s=480x270:r=30:d=1.2`,
            "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=1.2`,
            "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
            output,
        ], { encoding: "utf8" });
        if (result.status !== 0) throw new Error(`ffmpeg 生成测试视频失败：${result.stderr || result.error}`);
    }
}

async function openBrowser() {
    const launchOptions = { channel: process.env.AICYLD_E2E_BROWSER_CHANNEL || "chrome", headless, viewport: { width: 1440, height: 1000 }, locale: "zh-CN", acceptDownloads: true };
    if (profileDir) return chromium.launchPersistentContext(profileDir, launchOptions);
    browser = await chromium.launch({ channel: launchOptions.channel, headless });
    return browser.newContext({
        viewport: launchOptions.viewport,
        locale: launchOptions.locale,
        acceptDownloads: true,
        ...(storageStatePath ? { storageState: storageStatePath } : {}),
    });
}

async function responseData(response, label) {
    const text = await response.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`${label}: HTTP ${response.status()} non-JSON ${text.slice(0, 300)}`);
    }
    if (!response.ok() || parsed?.code !== 0) throw new Error(`${label}: HTTP ${response.status()} ${JSON.stringify(parsed).slice(0, 1000)}`);
    return parsed.data;
}

async function post(api, pathname, data) {
    return responseData(await api.post(`${baseURL}${pathname}`, { data }), `POST ${pathname}`);
}

async function get(api, pathname) {
    return responseData(await api.get(`${baseURL}${pathname}`), `GET ${pathname}`);
}

async function uploadFixture(api, index) {
    return (await responseData(await api.post(`${baseURL}/api/resources`, {
        multipart: {
            kind: "video",
            file: { name: `delivery-shot-${index + 1}.mp4`, mimeType: "video/mp4", buffer: fs.readFileSync(fixturePaths[index]) },
        },
    }), `upload fixture ${index + 1}`)).resource;
}

function renderPayload(resource, shotId) {
    return {
        version: 2,
        durationMs: 1200,
        tracks: [{ id: "video-track", kind: "video", label: "视频", order: 0 }],
        clips: [{
            id: `clip-${shotId}`,
            kind: "video",
            nodeId: shotId,
            trackId: "video-track",
            startMs: 0,
            durationMs: 1200,
            sourceStartMs: 0,
            directMedia: { id: shotId, kind: "video", title: shotId, storageKey: `resource:${resource.id}`, durationMs: 1200 },
        }],
    };
}

async function waitForTask(api, taskId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 180_000) {
        const task = await get(api, `/api/tasks/${encodeURIComponent(taskId)}`);
        if (task.status === "succeeded") return task;
        if (task.status === "failed" || task.status === "cancelled") throw new Error(`task ${taskId} ${task.status}: ${task.error || task.errorCode || "unknown"}`);
        await sleep(1000);
    }
    throw new Error(`task ${taskId} timed out`);
}

async function cleanup(api) {
    if (!api) return;
    for (const taskId of taskIds) await api.post(`${baseURL}/api/tasks/${encodeURIComponent(taskId)}/cancel`, { data: {} }).catch(() => undefined);
    if (projectId) await api.delete(`${baseURL}/api/projects/${encodeURIComponent(projectId)}`).catch(() => undefined);
}

try {
    createFixtures();
    context = await openBrowser();
    const api = context.request;
    const page = context.pages()[0] || await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror:${error.message}`));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`));

    const project = (await post(api, "/api/projects", {
        name: `交付E2E-${Date.now()}`,
        type: "short-drama",
        aspectRatio: "16:9",
        sourceType: "blank",
        description: "自动验收临时项目，完成后删除",
    })).project;
    projectId = project.id;
    const unit = (await post(api, `/api/projects/${encodeURIComponent(projectId)}/units`, { kind: "chapter", title: "验收章节", position: 0 })).unit;
    unitId = unit.id;
    const workflow = (await post(api, `/api/projects/${encodeURIComponent(projectId)}/workflows`, { unitId })).workflow;
    const videoStep = workflow.steps.find((step) => step.stepKey === "video");
    if (!videoStep) throw new Error("video workflow step missing");

    for (let index = 0; index < 2; index += 1) {
        const shot = (await post(api, `/api/projects/${encodeURIComponent(projectId)}/shots`, {
            unitId,
            title: `验收镜头 ${index + 1}`,
            description: `验收镜头 ${index + 1}`,
            position: index,
            durationMs: 1200,
            revision: { plotDescription: `验收镜头 ${index + 1}`, dialogue: index === 0 ? "第一镜验收字幕" : "第二镜验收字幕", videoPrompt: "纯色测试画面", durationMs: 1200 },
        })).shot;
        const resource = await uploadFixture(api, index);
        const task = await post(api, "/api/timeline/renders", {
            projectId,
            timeline: renderPayload(resource, shot.id),
            options: { width: 480, height: 270, fps: 30, sampleRate: 44100, burnSubtitles: false },
        });
        taskIds.push(task.id);
        const finished = await waitForTask(api, task.id);
        const renderResult = JSON.parse(finished.resultJson || "{}");
        if (!renderResult.resourceId) throw new Error(`render task ${task.id} has no resourceId`);
        await post(api, `/api/projects/${encodeURIComponent(projectId)}/workflow-steps/${encodeURIComponent(videoStep.id)}/task-output`, {
            taskId: task.id,
            unitId,
            shotId: shot.id,
            shotRevisionId: shot.currentRevisionId,
            artifactType: "video",
            resourceId: renderResult.resourceId,
            mediaType: "video",
            role: "output",
            metadataJson: JSON.stringify({ durationSeconds: 1.2 }),
        });
    }

    const detail = await get(api, `/api/projects/${encodeURIComponent(projectId)}`);
    const readyArtifacts = (detail.shotArtifacts || []).filter((artifact) => artifact.type === "video" && artifact.status === "ready");
    if (readyArtifacts.length !== 2) throw new Error(`expected 2 ready artifacts, got ${readyArtifacts.length}`);

    await page.goto(`${baseURL}/projects/${encodeURIComponent(projectId)}/workflow/${encodeURIComponent(unitId)}/delivery`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByRole("heading", { name: "一键成片", exact: true }).waitFor({ timeout: 30_000 });
    const renderButton = page.getByRole("button", { name: "一键成片", exact: true });
    if (await renderButton.isDisabled()) throw new Error("one-click render button is disabled");
    await renderButton.click();
    await page.getByRole("button", { name: "重新生成成片", exact: true }).waitFor({ state: "visible", timeout: 180_000 });
    await page.locator("video").last().waitFor({ state: "visible", timeout: 30_000 });

    const srtButton = page.getByRole("button", { name: "下载字幕 SRT", exact: true });
    if (await srtButton.isDisabled()) throw new Error("SRT download is disabled");
    const srtDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await srtButton.click();
    const srtPath = path.join(outputDir, "episode.srt");
    await (await srtDownloadPromise).saveAs(srtPath);
    const srtText = fs.readFileSync(srtPath, "utf8");
    if (!srtText.includes("第一镜验收字幕") || !srtText.includes("第二镜验收字幕")) throw new Error("downloaded SRT is missing expected dialogue");

    const mp4DownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "下载成片", exact: true }).click();
    const mp4Path = path.join(outputDir, "episode.mp4");
    await (await mp4DownloadPromise).saveAs(mp4Path);
    const mp4Bytes = fs.statSync(mp4Path).size;
    if (mp4Bytes < 10_000) throw new Error(`downloaded MP4 too small: ${mp4Bytes}`);

    const screenshotPath = path.join(outputDir, "delivery-success.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const report = { baseURL, readyArtifacts: readyArtifacts.length, srtBytes: fs.statSync(srtPath).size, mp4Bytes, consoleErrors, failedRequests, screenshotPath, mp4Path, srtPath };
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    await cleanup(api);
    const deleted = await api.get(`${baseURL}/api/projects/${encodeURIComponent(projectId)}`);
    if (deleted.status() !== 404) throw new Error(`test project cleanup failed: HTTP ${deleted.status()}`);
    projectId = "";
} finally {
    await cleanup(context?.request);
    await context?.close();
    await browser?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
