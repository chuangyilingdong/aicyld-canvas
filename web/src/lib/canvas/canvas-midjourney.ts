import type { GenerationTask } from "@/services/api/task-center";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, MidjourneyButton } from "@/types/canvas";

export const MIDJOURNEY_ACTIONS = [
    "imagine",
    "upscale",
    "variation",
    "high-variation",
    "low-variation",
    "reroll",
    "zoom",
    "pan",
    "inpaint",
    "modal",
    "remix-strong",
    "remix-subtle",
    "blend",
    "describe",
    "edits",
    "video",
] as const;

export type MidjourneyAction = (typeof MIDJOURNEY_ACTIONS)[number];

export const MIDJOURNEY_ACTION_LABELS: Record<MidjourneyAction, string> = {
    imagine: "Imagine",
    upscale: "放大",
    variation: "变体",
    "high-variation": "强变体",
    "low-variation": "弱变体",
    reroll: "重掷",
    zoom: "缩放",
    pan: "平移",
    inpaint: "进入局部重绘",
    modal: "补蒙版并提交",
    "remix-strong": "强重混",
    "remix-subtle": "弱重混",
    blend: "混合图片",
    describe: "反推提示词",
    edits: "图片编辑",
    video: "生成视频",
};

export type MidjourneyActionSubmission = {
    action: MidjourneyAction;
    prompt?: string;
    index?: number;
    customId?: string;
    direction?: "left" | "right" | "up" | "down";
    zoomRatio?: number;
    dimensions?: "LANDSCAPE" | "PORTRAIT" | "SQUARE";
    videoType?: string;
    animateMode?: "auto" | "manual";
    motion?: "low" | "high";
    batchSize?: 1 | 2 | 4;
    endUrl?: string;
    version?: string;
    referenceNodeIds?: string[];
    maskDataUrl?: string;
};

export type MidjourneyUpscaleMode = "normal" | "hd-subtle" | "hd-creative";

export const MIDJOURNEY_IMAGINE_QUALITIES = ["0.25", "0.5", "1", "2"] as const;
export const MIDJOURNEY_VERSIONS = ["8.2", "8.1", "7", "6.1", "5.2", "5.1"] as const;

/**
 * Build the upstream option bag for an Imagine request. `quality` here is MJ's
 * --q detail level; the top-level image quality remains the relax/fast/turbo
 * speed tier. `repeat` is intentionally omitted so a UI setting cannot
 * silently multiply the number of paid requests.
 */
export function midjourneyImagineRequestOptions(parameters?: Record<string, unknown>) {
    const options: Record<string, unknown> = { action: "imagine" };
    if (!parameters) return options;

    const quality = stringOption(parameters.quality);
    if ((MIDJOURNEY_IMAGINE_QUALITIES as readonly string[]).includes(quality)) options.quality = quality;
    const version = stringOption(parameters.version).replace(/^v/i, "");
    if ((MIDJOURNEY_VERSIONS as readonly string[]).includes(version)) options.version = version;
    const style = stringOption(parameters.style).toLowerCase();
    if (style === "raw") options.style = style;

    for (const key of ["negativePrompt", "cref", "sref", "dref", "extra"] as const) {
        const value = stringOption(parameters[key]);
        if (value) options[key] = value;
    }
    for (const key of ["seed", "stylize", "chaos", "weird", "cw", "sw", "iw", "dw", "stop"] as const) {
        const value = Number(parameters[key]);
        if (Number.isFinite(value)) options[key] = value;
    }
    for (const key of ["tile", "niji", "raw", "draft", "hd"] as const) {
        if (typeof parameters[key] === "boolean") options[key] = parameters[key];
    }
    return options;
}

export type MidjourneyActionCapability = {
    action: MidjourneyAction;
    enabled: boolean;
    reason?: string;
    needsPrompt?: boolean;
    needsMask?: boolean;
    needsParent?: boolean;
    needsImages?: boolean;
};

const GRID_PARENT_ACTIONS = new Set(["imagine", "reroll", "variation", "high-variation", "low-variation", "blend"]);
const SINGLE_PARENT_ACTIONS = new Set(["upscale", "zoom", "pan", "remix-strong", "remix-subtle", "edits"]);

export function midjourneyActionFromNode(node: Pick<CanvasNodeData, "metadata"> | null | undefined): MidjourneyAction | "" {
    const metadata = node?.metadata;
    if (metadata?.midjourneyModalSubmittedTaskId && metadata.midjourneyModalSubmittedTaskId === metadata.taskId) return "modal";
    return normalizeMidjourneyAction(metadata?.midjourneyAction);
}

export function midjourneyUpstreamTaskId(node: Pick<CanvasNodeData, "metadata"> | null | undefined) {
    // Canvas task ids identify local task-center rows. Only the provider
    // request id is valid as a Midjourney parent task_id.
    return node?.metadata?.taskProviderRequestId?.trim() || "";
}

export function midjourneyHdUpscaleCommand(version: string, mode: Exclude<MidjourneyUpscaleMode, "normal">) {
    const number = midjourneyVersionNumber(version.replace(/^v/i, ""));
    if (!Number.isFinite(number)) return "";
    if (number >= 8.2) return "";
    if (number >= 7) return mode === "hd-subtle" ? "upsample_v7_2x_subtle" : "upsample_v7_2x_creative";
    if (number >= 6) return mode === "hd-subtle" ? "upsample_v6_2x_subtle" : "upsample_v6_2x_creative";
    if (number >= 5.1) return mode === "hd-subtle" ? "upsample_v5_2x" : "upsample_v5_4x";
    return "";
}

export function midjourneyHdUpscaleCustomId(
    node: Pick<CanvasNodeData, "metadata">,
    index: number,
    mode: MidjourneyUpscaleMode,
    versionOverride = "",
) {
    if (mode === "normal") return "";
    const selectedIndex = Math.max(1, Math.min(4, Math.floor(Number(index) || 1)));
    const version = versionOverride.trim() || stringOption(node.metadata?.midjourneyVersion);
    const command = midjourneyHdUpscaleCommand(version, mode);
    if (!command) return "";
    const button = (node.metadata?.midjourneyButtons || []).find((item) => {
        const match = item.customId.match(/^MJ::JOB::upsample::(\d+)::(.+)$/);
        return match?.[1] === String(selectedIndex) && Boolean(match[2]);
    });
    const match = button?.customId.match(/^MJ::JOB::upsample::(\d+)::(.+)$/);
    if (!match?.[2]) return "";
    return `MJ::JOB::${command}::${selectedIndex}::${match[2]}`;
}

export function midjourneyHdUpscaleUnavailableReason(node: Pick<CanvasNodeData, "metadata">, index: number, versionOverride = "") {
    const selectedIndex = Math.max(1, Math.min(4, Math.floor(Number(index) || 1)));
    const version = versionOverride.trim() || stringOption(node.metadata?.midjourneyVersion);
    if (!(node.metadata?.midjourneyButtons || []).some((item) => item.customId.startsWith(`MJ::JOB::upsample::${selectedIndex}::`))) {
        return "父任务没有保存 U" + selectedIndex + " 按钮，请重新生成后再用 HD 放大";
    }
    if (!version) return "请先在下方选择 Midjourney 版本";
    const number = midjourneyVersionNumber(version.replace(/^v/i, ""));
    if (number >= 8.2) return "上游文档尚未列出 v8.2 的 HD 放大命令";
    if (number < 5.1) return "当前 Midjourney 版本不支持 HD 放大";
    return "";
}

export function midjourneyVideoIndexForNode(node: Pick<CanvasNodeData, "metadata"> | null | undefined) {
    return Math.max(0, Math.min(3, Math.floor(Number(node?.metadata?.taskOutputIndex) || 0)));
}

export function midjourneyIndexForNode(node: Pick<CanvasNodeData, "metadata"> | null | undefined) {
    return Math.max(1, Math.min(4, Math.floor(Number(node?.metadata?.taskOutputIndex) || 0) + 1));
}

export function isMidjourneyNode(node: Pick<CanvasNodeData, "metadata"> | null | undefined) {
    const metadata = node?.metadata;
    if (!metadata) return false;
    const model = String(metadata.model || "").toLowerCase();
    const provider = String(metadata.taskProvider || "").toLowerCase();
    return provider === "midjourney" || model.includes("midjourney") || Boolean(normalizeMidjourneyAction(metadata.midjourneyAction));
}

export function midjourneyResultMode(action: MidjourneyAction | ""): CanvasGenerationMode {
    if (action === "describe") return "text";
    if (action === "video") return "video";
    return "image";
}

export function midjourneyTaskOptions(task: GenerationTask): Record<string, unknown> {
    const modelIsMidjourney = task.type === "canvas_image" && Boolean(task.model?.toLowerCase().includes("midjourney"));
    if (!task.inputJson) return modelIsMidjourney ? { action: "imagine" } : {};
    try {
        const input = JSON.parse(task.inputJson) as {
            metadata?: { midjourney?: unknown };
            config?: { interfaceType?: unknown };
        };
        if (isRecord(input.metadata?.midjourney)) return input.metadata.midjourney;
        const interfaceType = typeof input.config?.interfaceType === "string" ? input.config.interfaceType : "";
        if (interfaceType === "midjourney" || modelIsMidjourney) return { action: "imagine" };
        return {};
    } catch {
        return modelIsMidjourney ? { action: "imagine" } : {};
    }
}

export function midjourneyActionFromTask(task: GenerationTask): MidjourneyAction | "" {
    return normalizeMidjourneyAction(midjourneyTaskOptions(task).action);
}

export function midjourneyTaskMetadata(task: GenerationTask): Partial<CanvasNodeMetadata> {
    const options = midjourneyTaskOptions(task);
    const action = normalizeMidjourneyAction(options.action);
    if (!action) return {};
    const metadata: Partial<CanvasNodeMetadata> = { midjourneyAction: action, midjourneyParameters: { ...options } };
    const parentTaskId = stringOption(options.taskId);
    const version = stringOption(options.version);
    if (parentTaskId) metadata.midjourneyParentTaskId = parentTaskId;
    if (version) metadata.midjourneyVersion = version;
    const buttons = midjourneyTaskButtons(task);
    if (buttons.length) metadata.midjourneyButtons = buttons;
    if (action === "inpaint") {
        metadata.midjourneyStage = "inpaint";
        metadata.midjourneyNextAction = "modal";
    } else if (action === "modal") {
        metadata.midjourneyStage = "modal";
    }
    return metadata;
}

export function midjourneyTaskButtons(task: GenerationTask): MidjourneyButton[] {
    if (!task.resultJson?.includes('"midjourneyButtons"')) return [];
    const providerMetadata = jsonObjectAfterKey(task.resultJson, "providerMetadata");
    if (!providerMetadata || !Array.isArray(providerMetadata.midjourneyButtons)) return [];
    return providerMetadata.midjourneyButtons.flatMap((item) => {
        if (!isRecord(item)) return [];
        const customId = stringOption(item.customId);
        if (!customId) return [];
        return [{ customId, label: stringOption(item.label) || undefined, emoji: stringOption(item.emoji) || undefined }];
    });
}

export function midjourneyActionCapabilities(node: Pick<CanvasNodeData, "metadata">): MidjourneyActionCapability[] {
    const parentAction = midjourneyActionFromNode(node as CanvasNodeData);
    const hasParent = Boolean(midjourneyUpstreamTaskId(node as CanvasNodeData));
    const version = String(node.metadata?.midjourneyVersion || "").toLowerCase();
    const versionNumber = midjourneyVersionNumber(version);
    const isV8 = versionNumber >= 8 && versionNumber < 9;
    const base = new Map<MidjourneyAction, MidjourneyActionCapability>();
    const add = (action: MidjourneyAction, extra: Partial<Omit<MidjourneyActionCapability, "action">> = {}) => {
        base.set(action, { action, enabled: true, ...extra });
    };
    const parentActionCapability = (action: MidjourneyAction) => ({
        needsParent: true,
        enabled: hasParent,
        reason: hasParent ? undefined : "缺少上游 task_id",
    });

    if (parentAction === "inpaint") {
        add("modal", {
            enabled: hasParent,
            reason: hasParent ? undefined : "缺少 inpaint 上游 task_id，不能提交 MODAL",
            needsPrompt: true,
            needsMask: true,
            needsParent: true,
        });
    } else {
        // Source-image actions remain available even when the node predates
        // action metadata. Parent-task actions do not, because guessing the
        // parent type could bill an invalid upstream request.
        add("describe", { needsImages: true });
        add("edits", { needsPrompt: true, needsImages: true });
        add("blend", { needsImages: true });
        add("video", { needsPrompt: false });

        if (GRID_PARENT_ACTIONS.has(parentAction)) {
            add("upscale", {
                ...parentActionCapability("upscale"),
                enabled: hasParent && !isV8,
                reason: !hasParent ? "缺少上游 task_id" : isV8 ? "v8 操作面板已移除 U1–U4，请使用 Variation / Reroll" : undefined,
            });
            add("variation", parentActionCapability("variation"));
            if (parentAction === "imagine" || parentAction === "reroll") add("reroll", parentActionCapability("reroll"));
            if (parentAction === "imagine" && (!version || isV8)) {
                add("remix-strong", { ...parentActionCapability("remix-strong"), reason: isV8 ? undefined : "仅 v8.1 / v8.2 父任务可用" });
                add("remix-subtle", { ...parentActionCapability("remix-subtle"), reason: isV8 ? undefined : "仅 v8.1 / v8.2 父任务可用" });
            }
        } else if (SINGLE_PARENT_ACTIONS.has(parentAction)) {
            add("high-variation", parentActionCapability("high-variation"));
            add("low-variation", parentActionCapability("low-variation"));
            if (parentAction === "upscale" && !isV8) {
                add("zoom", parentActionCapability("zoom"));
                add("pan", { ...parentActionCapability("pan"), enabled: false, reason: "上游当前不支持 Pan（包括 HD upscale）" });
                add("inpaint", parentActionCapability("inpaint"));
            }
            if (!version || isV8) {
                add("remix-strong", { ...parentActionCapability("remix-strong"), reason: isV8 ? undefined : "仅 v8.1 / v8.2 父任务可用" });
                add("remix-subtle", { ...parentActionCapability("remix-subtle"), reason: isV8 ? undefined : "仅 v8.1 / v8.2 父任务可用" });
            }
        }
    }

    if (version && versionNumber < 6) {
        const video = base.get("video");
        if (video) base.set("video", { ...video, enabled: false, reason: "当前 Midjourney 版本低于 v6，不开放视频动作" });
        const pan = base.get("pan");
        if (pan) base.set("pan", { ...pan, enabled: false, reason: "Pan 仅适用于 v6 及以上版本" });
    }
    if (version && versionNumber <= 4) {
        for (const action of ["high-variation", "low-variation"] as const) {
            const item = base.get(action);
            if (item) base.set(action, { ...item, enabled: false, reason: "当前 Midjourney 版本不开放强弱变体" });
        }
    }
    if (isV8) {
        for (const action of ["upscale", "zoom", "pan", "inpaint"] as const) {
            const item = base.get(action);
            if (item) base.set(action, { ...item, enabled: false, reason: "v8 操作面板已移除该动作" });
        }
    }
    return MIDJOURNEY_ACTIONS.flatMap((action) => {
        const item = base.get(action);
        return item ? [item] : [];
    });
}

function normalizeMidjourneyAction(value: unknown): MidjourneyAction | "" {
    const action = typeof value === "string" ? value.trim().toLowerCase() : "";
    return (MIDJOURNEY_ACTIONS as readonly string[]).includes(action) ? (action as MidjourneyAction) : "";
}

function midjourneyVersionNumber(version: string) {
    const match = version.match(/v?(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function stringOption(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function jsonObjectAfterKey(json: string, key: string): Record<string, unknown> | null {
    const keyIndex = json.indexOf(`"${key}"`);
    if (keyIndex < 0) return null;
    const colonIndex = json.indexOf(":", keyIndex + key.length + 2);
    const start = colonIndex >= 0 ? json.indexOf("{", colonIndex + 1) : -1;
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < json.length; index += 1) {
        const char = json[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                try {
                    const parsed = JSON.parse(json.slice(start, index + 1));
                    return isRecord(parsed) ? parsed : null;
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
