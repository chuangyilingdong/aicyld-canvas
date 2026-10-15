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

/**
 * 平台能力里声明了「参考图编辑」的图片模型（由 applyPlatformFeatureModels 从渠道
 * capabilityConfig.image.operations 收集）。名字约定只是兜底，权威判定看能力声明——
 * 例如 zhenzhen-image-g-v2.5-lowprice 名字里没有 i2i/edit，但它上游是支持参考图编辑的。
 */
let capabilityImageEditModels = new Set<string>();

export function setCapabilityImageEditModels(models: Iterable<string>) {
    capabilityImageEditModels = new Set(Array.from(models).map((value) => String(value || "").trim()).filter(Boolean));
}

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

export type CanvasAudioPurpose = "voice" | "music" | "sfx";

/**
 * 按模型名判断它属于哪种音频用途：配音（TTS）/ 音乐（BGM）/ 音效。
 * 用途决定音频框体里可选哪些模型，以及没选时用哪个默认档。
 */
export function classifyAudioModelPurpose(model: string | undefined): CanvasAudioPurpose {
    const name = String(model || "").toLowerCase();
    if (/sound|sfx|foley/.test(name)) return "sfx";
    if (/mureka|music|bgm|song/.test(name)) return "music";
    return "voice";
}

/** 该用途当前是否有可用模型（决定「用途」下拉里显不显示这一项）。 */
export function hasAudioPurposeModel(purpose: CanvasAudioPurpose): boolean {
    return Boolean(canvasAudioPurposeModel(purpose));
}

/** 音频节点按用途取平台内置模型：配音走 audio.tts，音乐走 audio.music。 */
export function canvasAudioPurposeModel(purpose: string | undefined): string | undefined {
    if (purpose === "music") {
        return canvasFeatureModel("audio.music") || canvasFeatureModel("audio.tts");
    }
    if (purpose === "sfx") {
        return canvasFeatureModel("audio.sfx") || canvasFeatureModel("audio.tts");
    }
    return canvasFeatureModel("audio.tts") || canvasFeatureModel("audio.music") || canvasFeatureModel("audio.sfx");
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
    // 每次下发渠道能力时刷新「可编辑图片模型」名单，供 resolveImageEditModel 判定。
    collectCapabilityImageEditModels(config as unknown as ChannelCapabilityLike);
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

/** 该模型是否本身就具备图改图（参考图编辑）能力：先看平台能力声明，再退回名字约定。 */
export function isImageEditModel(model: string | undefined) {
    const value = String(model || "").trim();
    if (!value) return false;
    if (capabilityImageEditModels.has(value)) return true;
    const name = (value.includes("::") ? value.split("::").pop() || "" : value).toLowerCase();
    if (capabilityImageEditModels.has(name)) return true;
    if (/(^|[^a-z])(i2i|edit|inpaint)([^a-z]|$)/.test(name)) return true;
    // 厂商文档明确「支持文生图和参考图编辑」的一族（Image G v2.5 低价扩展版）；
    // 能力声明是权威，这条只是配置没带 operations 时的兜底。
    return /(^|[^a-z])g-v2\.5-lowprice$/.test(name);
}

type ChannelCapabilityLike = {
    channels?: Array<{
        id?: string;
        modelProfiles?: Array<{
            model?: string;
            capability?: string;
            capabilityConfig?: { image?: { operations?: unknown } };
        }>;
    }>;
};

/** 把渠道能力里声明 image_to_image 的图片模型登记进来（含 channel::model 写法）。 */
export function collectCapabilityImageEditModels(config: ChannelCapabilityLike | undefined) {
    const models: string[] = [];
    for (const channel of config?.channels || []) {
        for (const profile of channel?.modelProfiles || []) {
            if (profile?.capability !== "image") continue;
            const operations = profile?.capabilityConfig?.image?.operations;
            if (!Array.isArray(operations) || !operations.includes("image_to_image")) continue;
            const name = String(profile.model || "").trim();
            if (!name) continue;
            models.push(name);
            if (channel.id) models.push(`${channel.id}::${name}`);
        }
    }
    setCapabilityImageEditModels(models);
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