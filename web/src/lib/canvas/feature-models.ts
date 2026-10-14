/**
 * 平台内置「功能 → 模型」映射（后端 /api/workspace/model-config 下发 featureModels）。
 * 画布各功能直接用平台绑定的模型，用户端不再选模型。
 */
export type CanvasFeatureKey =
    | "text.chat"
    | "image.vision"
    | "image.t2i"
    | "image.edit"
    | "video.t2v"
    | "video.i2v"
    | "video.multi"
    | "audio.tts";

let featureModels: Record<string, string> = {};

export function setCanvasFeatureModels(next: unknown) {
    featureModels = sanitizeFeatureModels(next);
}

export function canvasFeatureModel(key: CanvasFeatureKey): string | undefined {
    const value = featureModels[key];
    return value ? value : undefined;
}

/** 该模型是否本身就具备图改图（i2i）能力。 */
export function isImageEditModel(model: string | undefined) {
    return /(^|[^a-z])(i2i|edit|inpaint)([^a-z]|$)/.test(String(model || "").split("::").pop()?.toLowerCase() || "");
}

/**
 * 图片编辑类功能（局部重绘 / 表情 / 质感 / 角度 / 打光 / 图生图）解析实际使用的模型：
 * 节点上已经是图改图档时沿用，否则回退到平台绑定的「图片编辑」模型。
 */
export function resolveImageEditModel(candidate: string | undefined) {
    const trimmed = String(candidate || "").trim();
    if (isImageEditModel(trimmed)) return trimmed;
    return canvasFeatureModel("image.edit") || trimmed;
}

function sanitizeFeatureModels(next: unknown): Record<string, string> {
    if (!next || typeof next !== "object") return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) result[key] = trimmed;
    }
    return result;
}