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

/** 平台是否下发了「功能 → 模型」映射（托管形态下为真，此时画布不让用户选模型）。 */
export function hasPlatformFeatureModels() {
    return Object.keys(featureModels).length > 0;
}

export type CanvasGenerationMode = "text" | "image" | "video" | "audio";

const modeFeatureKeys: Record<CanvasGenerationMode, CanvasFeatureKey[]> = {
    text: ["text.chat"],
    image: ["image.t2i"],
    video: ["video.t2v", "video.i2v", "video.multi"],
    audio: ["audio.tts"],
};

const modeModelField: Record<CanvasGenerationMode, "textModel" | "imageModel" | "videoModel" | "audioModel"> = {
    text: "textModel",
    image: "imageModel",
    video: "videoModel",
    audio: "audioModel",
};

/** 某个生成模式对应的平台内置模型（未绑定则返回 undefined，调用方回退原逻辑）。 */
export function canvasFeatureModelForMode(mode: CanvasGenerationMode): string | undefined {
    for (const key of modeFeatureKeys[mode] || []) {
        const model = canvasFeatureModel(key);
        if (model) return model;
    }
    return undefined;
}

/** 把配置里的模型替换成平台内置模型（同时同步该模式的默认模型字段）。 */
export function withPlatformFeatureModel<T extends { model?: string }, K extends CanvasGenerationMode>(
    config: T,
    mode: K,
): T {
    const model = canvasFeatureModelForMode(mode);
    if (!model) return config;
    return { ...config, model, [modeModelField[mode]]: model } as T;
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