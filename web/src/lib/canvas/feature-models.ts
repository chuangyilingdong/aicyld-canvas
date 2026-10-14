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
    | "audio.tts"
    | "audio.music"
    | "audio.sfx";

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

/**
 * 功能专用模型：这些模型只服务于某个平台功能（图改图、图片理解），
 * 由功能内部直接取用，不应该出现在用户的模型选择器里。
 */
export function functionOnlyModelValues(): string[] {
    const keys: CanvasFeatureKey[] = ["image.edit", "image.vision"];
    return keys
        .map((key) => canvasFeatureModel(key))
        .filter((value): value is string => Boolean(value));
}

export type CanvasAudioPurpose = "voice" | "music";

/** 音频节点按用途取平台内置模型：配音走 audio.tts，音乐走 audio.music。 */
export function canvasAudioPurposeModel(purpose: string | undefined): string | undefined {
    if (purpose === "music") {
        return canvasFeatureModel("audio.music") || canvasFeatureModel("audio.tts");
    }
    return canvasFeatureModel("audio.tts") || canvasFeatureModel("audio.music");
}

/** 图改图专用：把模型替换成平台绑定的「图片编辑」模型。 */
export function withPlatformImageEditModel<T extends { model?: string }>(config: T): T {
    const model = canvasFeatureModel("image.edit");
    if (!model) return config;
    return { ...config, model, imageModel: model } as T;
}

/**
 * 把平台内置模型写进「默认模型」字段（托管形态启动时调用一次）。
 * 这样新建节点默认就用平台模型，用户仍可在节点上改。
 */
export function applyPlatformFeatureModels<
    T extends { textModel?: string; imageModel?: string; videoModel?: string; audioModel?: string },
>(config: T): T {
    const text = canvasFeatureModel("text.chat");
    const image = canvasFeatureModel("image.t2i");
    const video = canvasFeatureModelForMode("video");
    const audio = canvasFeatureModel("audio.tts");
    if (!text && !image && !video && !audio) return config;
    return {
        ...config,
        textModel: text || config.textModel,
        imageModel: image || config.imageModel,
        videoModel: video || config.videoModel,
        audioModel: audio || config.audioModel,
    } as T;
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