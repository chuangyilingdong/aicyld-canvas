#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium, type Browser, type BrowserContext } from "playwright";

import { parseGeneratedSmartFilmScripts, smartFilmScriptPrompt } from "../src/lib/canvas/smart-film-scripts";

const baseURL = String(process.env.AICYLD_E2E_BASE_URL || "").trim().replace(/\/+$/, "");
if (!baseURL) throw new Error("缺少 AICYLD_E2E_BASE_URL");
if (new URL(baseURL).hostname === "hb.aicyld.com.cn" && process.env.AICYLD_E2E_ALLOW_PRODUCTION !== "1") {
    throw new Error("默认拒绝在生产环境运行付费生成 E2E；如确认会实际扣除积分，请设置 AICYLD_E2E_ALLOW_PRODUCTION=1");
}
if (process.env.AICYLD_E2E_PAID !== "1") {
    throw new Error("该脚本会创建真实付费文本任务；请显式设置 AICYLD_E2E_PAID=1");
}

const storageStatePath = process.env.AICYLD_E2E_STORAGE_STATE || "";
const profileDir = process.env.AICYLD_E2E_PROFILE_DIR || "";
const ssoCookie = process.env.AICYLD_E2E_SSO_COOKIE || "";
const outputDir = path.resolve(process.env.AICYLD_E2E_OUTPUT_DIR || "output/smart-film-script-paid-e2e");
const requestedModel = String(process.env.AICYLD_E2E_TEXT_MODEL || "").trim();
const keepBatch = process.env.AICYLD_E2E_KEEP_BATCH === "1";
const taskTimeoutMs = Math.max(60_000, Number(process.env.AICYLD_E2E_TASK_TIMEOUT_MS || 300_000));
const settleTimeoutMs = Math.max(10_000, Number(process.env.AICYLD_E2E_SETTLE_TIMEOUT_MS || 60_000));

fs.mkdirSync(outputDir, { recursive: true });

type ModelProfile = {
    model: string;
    capability?: string;
    protocol?: string;
    credentialRef?: string;
};

type Channel = {
    id: string;
    apiFormat?: string;
    interfaceType?: string;
    baseUrl?: string;
    apiKey?: string;
    secretKey?: string;
    credentialRef?: string;
    headers?: unknown[];
    modelProfiles?: ModelProfile[];
};

type WorkspaceConfig = {
    textModel?: string;
    imageModel?: string;
    videoModel?: string;
    vquality?: string;
    systemPrompt?: string;
    channels?: Channel[];
};

type Task = {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    billingStatus?: string;
    billingPoints?: number;
    resultJson?: string;
    error?: string;
    errorCode?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function responseData<T>(response: Awaited<ReturnType<BrowserContext["request"]["get"]>>, label: string): Promise<T> {
    const text = await response.text();
    let parsed: { code?: number; data?: T };
    try {
        parsed = JSON.parse(text) as typeof parsed;
    } catch {
        throw new Error(`${label}: HTTP ${response.status()} non-JSON ${text.slice(0, 500)}`);
    }
    if (!response.ok() || parsed.code !== 0) throw new Error(`${label}: HTTP ${response.status()} ${JSON.stringify(parsed).slice(0, 1000)}`);
    return parsed.data as T;
}

async function openContext(): Promise<{ browser?: Browser; context: BrowserContext }> {
    const options = {
        channel: process.env.AICYLD_E2E_BROWSER_CHANNEL || "chrome",
        headless: process.env.AICYLD_E2E_HEADLESS !== "0",
        viewport: { width: 1440, height: 1000 },
        locale: "zh-CN",
        acceptDownloads: true,
    };
    if (profileDir) {
        const context = await chromium.launchPersistentContext(profileDir, options);
        if (ssoCookie) await addSSOCookie(context);
        return { context };
    }
    const browser = await chromium.launch({ channel: options.channel, headless: options.headless });
    const context = await browser.newContext({
        viewport: options.viewport,
        locale: options.locale,
        acceptDownloads: true,
        ...(storageStatePath ? { storageState: storageStatePath } : {}),
    });
    if (ssoCookie) await addSSOCookie(context);
    return { browser, context };
}

async function addSSOCookie(context: BrowserContext) {
    await context.addCookies([{
        name: "aicyld_sso",
        value: ssoCookie,
        domain: new URL(baseURL).hostname,
        path: "/",
        httpOnly: true,
        secure: new URL(baseURL).protocol === "https:",
        sameSite: "Lax",
    }]);
}

function selectTextModel(config: WorkspaceConfig) {
    const options = config.channels?.flatMap((channel) =>
        (channel.modelProfiles || []).filter((profile) => profile.capability === "text").map((profile) => `${channel.id}::${profile.model}`),
    ) || [];
    if (!options.length) throw new Error("当前工作区没有文本模型");
    const selected = requestedModel
        ? options.find((option) => option === requestedModel) || options.find((option) => option.includes(requestedModel))
        : options.find((option) => option.includes("moonshotai/kimi-k3.1-pro")) ||
          options.find((option) => option.includes("moonshotai/kimi-k3")) ||
          config.textModel ||
          options[0];
    if (!selected) throw new Error(`找不到指定文本模型：${requestedModel}`);
    const split = selected.indexOf("::");
    if (split < 1) throw new Error(`文本模型标识缺少渠道：${selected}`);
    const channelId = selected.slice(0, split);
    const model = selected.slice(split + 2);
    const channel = config.channels?.find((item) => item.id === channelId);
    const profile = channel?.modelProfiles?.find((item) => item.model === model && item.capability === "text");
    if (!channel || !profile) throw new Error(`文本模型缺少渠道或能力配置：${selected}`);
    return { option: selected, channel, profile, model };
}

function textProvider(config: WorkspaceConfig, selected: ReturnType<typeof selectTextModel>) {
    const { channel, profile, model } = selected;
    return {
        channelId: channel.id,
        apiFormat: channel.apiFormat,
        interfaceType: profile.protocol || channel.interfaceType,
        baseUrl: channel.baseUrl,
        apiKey: channel.credentialRef ? "" : channel.apiKey,
        secretKey: channel.credentialRef ? "" : channel.secretKey,
        headers: channel.headers || [],
        credentialRef: channel.credentialRef || profile.credentialRef,
        model,
        systemPrompt: config.systemPrompt || "",
    };
}

async function waitForTask(api: BrowserContext["request"], taskId: string): Promise<Task> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < taskTimeoutMs) {
        const task = await responseData<Task>(await api.get(`${baseURL}/api/tasks/${encodeURIComponent(taskId)}`), `GET /api/tasks/${taskId}`);
        if (["succeeded", "failed", "cancelled"].includes(task.status)) return task;
        await sleep(1500);
    }
    throw new Error(`文本任务 ${taskId} 超时`);
}

async function waitForSettlement(api: BrowserContext["request"], task: Task): Promise<Task> {
    if (task.billingStatus && task.billingStatus !== "reserved") return task;
    const startedAt = Date.now();
    while (Date.now() - startedAt < settleTimeoutMs) {
        const current = await responseData<Task>(await api.get(`${baseURL}/api/tasks/${encodeURIComponent(task.id)}`), `GET settled task ${task.id}`);
        if (current.billingStatus && current.billingStatus !== "reserved") return current;
        await sleep(1000);
    }
    return task;
}

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let batchId = "";
let taskId = "";
let taskTerminal = false;

try {
    const opened = await openContext();
    browser = opened.browser;
    context = opened.context;
    const api = context.request;
    const workspace = await responseData<{ config: WorkspaceConfig }>(await api.get(`${baseURL}/api/workspace/model-config`), "GET workspace model config");
    const config = workspace.config;
    const selected = selectTextModel(config);
    const idea = `付费结算验收 ${Date.now()}：设计一条 5 秒的智能咖啡杯短视频，突出保温、便携和清洗方便。只生成 1 条。`;
    const prompt = smartFilmScriptPrompt({ idea, references: [], count: 1 });
    const provider = textProvider(config, selected);
    const batchInput = {
        title: "付费结算 E2E 临时批次",
        sourceText: idea,
        scriptPrompt: prompt,
        inputAssetIds: [],
        config: {
            aspectRatio: "9:16",
            defaultTextModel: selected.option,
            defaultImageModel: config.imageModel || "",
            defaultVideoModel: config.videoModel || "",
            defaultVideoResolution: config.vquality || "",
            inputAssetRoles: {},
            inputAssetNames: {},
            scriptCount: 1,
        },
        orchestrationConfig: { text: provider },
    };

    const preview = await responseData<{ totalPoints: number; items: Array<{ points: number; count: number }> }>(
        await api.post(`${baseURL}/api/smart-film-batches/cost-preview`, { data: batchInput }),
        "POST batch cost preview",
    );
    if (!(preview.totalPoints > 0)) throw new Error("剧本报价为 0，无法验证真实扣费");
    const created = await responseData<{ batch: { id: string; revision: number; budgetPoints: number } }>(
        await api.post(`${baseURL}/api/smart-film-batches`, { data: { ...batchInput, budgetPoints: preview.totalPoints } }),
        "POST smart-film batch",
    );
    batchId = created.batch.id;

    const taskInput = {
        type: "canvas_text",
        operation: "text",
        prompt,
        model: selected.model,
        input: {
            mode: "text",
            prompt,
            config: provider,
            textOptions: { stream: false, thinking: false },
            referenceImages: [],
            metadata: { source: "smart-film-batch-script", batchId, scriptCount: 1, regenerateIndex: 0 },
        },
    };
    const taskQuote = await responseData<{ enabled: boolean; points: number; balance: number; displayName?: string; breakdown?: Record<string, unknown> }>(
        await api.post(`${baseURL}/api/tasks/quote`, { data: taskInput }),
        "POST script quote",
    );
    const task = await responseData<Task>(await api.post(`${baseURL}/api/tasks`, { data: taskInput }), "POST paid script task");
    taskId = task.id;
    const finished = await waitForTask(api, task.id);
    taskTerminal = true;
    if (finished.status !== "succeeded") throw new Error(`文本任务失败：${finished.errorCode || finished.error || finished.status}`);
    const settled = await waitForSettlement(api, finished);
    if (!settled.billingStatus || settled.billingStatus === "reserved") throw new Error(`文本任务未完成计费结算：${settled.billingStatus || "missing"}`);
    const result = JSON.parse(settled.resultJson || "{}") as { text?: string };
    const scripts = parseGeneratedSmartFilmScripts(result.text || "");
    if (scripts.length !== 1) throw new Error(`模型返回有效剧本 ${scripts.length} 条，预期 1 条`);

    const saved = await responseData<{ batch: { scripts: Array<{ id: string; title: string }>; revision: number } }>(
        await api.put(`${baseURL}/api/smart-film-batches/${encodeURIComponent(batchId)}/scripts`, {
            data: { scripts: [{ title: scripts[0].title, content: scripts[0].content, taskId }], expectedRevision: created.batch.revision },
        }),
        "PUT generated scripts",
    );
    if (saved.batch.scripts.length !== 1) throw new Error("剧本保存后数量不正确");

    const reportPath = path.join(outputDir, "report.json");
    const report = {
        baseURL,
        model: selected.option,
        batchId,
        taskId,
        taskQuotePoints: taskQuote.points,
        batchQuotePoints: preview.totalPoints,
        settledBillingStatus: settled.billingStatus,
        settledBillingPoints: settled.billingPoints,
        billingDifference: typeof settled.billingPoints === "number" ? settled.billingPoints - taskQuote.points : null,
        scriptTitle: scripts[0].title,
        reportPath,
        checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
} finally {
    if (context && batchId && !keepBatch) {
        await context.request.delete(`${baseURL}/api/smart-film-batches/${encodeURIComponent(batchId)}`).catch(() => undefined);
    }
    if (context && taskId && !taskTerminal) {
        await context.request.post(`${baseURL}/api/tasks/${encodeURIComponent(taskId)}/cancel`, { data: {} }).catch(() => undefined);
    }
    await context?.close();
    await browser?.close();
}
