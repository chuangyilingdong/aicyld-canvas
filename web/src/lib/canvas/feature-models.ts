/**
 * 平台内置「功能 → 模型」映射（后端 /api/workspace/model-config 下发 featureModels）。
 * 节点上显式选择的模型优先；没有选择时才使用平台默认绑定。
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
    | "audio.music";

export type CanvasGenerationMode = "text" | "image" | "video" | "audio";

type CanvasFeatureInput = {
    input?: { imageCount: number; videoCount: number; audioCount: number; characterCount: number };
    videoOperation?: string;
};

let featureModels: Record<string, string> = {};
let capabilityImageEditModels = new Set<string>();

export function setCanvasFeatureModels(next: unknown) {
    featureModels = sanitizeFeatureModels(next);
}

export function canvasFeatureModel(key: CanvasFeatureKey): string | undefined {
    const value = featureModels[key];
    return value ? value : undefined;
}

/** 平台是否下发了「功能 → 模型」映射。 */
export function hasPlatformFeatureModels() {
    return Object.keys(featureModels).length > 0;
}

/**
 * 某个生成模式实际应使用的平台模型。
 *
 * 图片默认使用文生图档，带参考图时由 generation executor 升级为 image.edit。
 * 视频必须按本次输入选模式，不能永远取 video.t2v：一个图片是图生视频，
 * 多素材/视频参考是全模态参考。
 */
export function canvasFeatureModelForMode(mode: CanvasGenerationMode, context?: CanvasFeatureInput): string | undefined {
    if (mode === "text") return canvasFeatureModel("text.chat");
    if (mode === "image") return canvasFeatureModel("image.t2i");
    if (mode === "audio") return canvasFeatureModel("audio.tts");

    const input = context?.input;
    const operation = String(context?.videoOperation || "").trim();
    const visualCount = (input?.imageCount || 0) + (input?.characterCount || 0);
    if (operation === "reference_to_video" || (input?.videoCount || 0) > 0 || visualCount > 2) {
        return canvasFeatureModel("video.multi");
    }
    if (operation === "image_to_video" || operation === "extend" || operation === "draft_to_final" || visualCount > 0) {
        return canvasFeatureModel("video.i2v");
    }
    if (operation === "audio_to_video") {
        return canvasFeatureModel("video.multi") || canvasFeatureModel("video.t2v");
    }
    if (operation === "text_to_video" || !input) return canvasFeatureModel("video.t2v");
    return canvasFeatureModel("video.t2v") || canvasFeatureModel("video.i2v") || canvasFeatureModel("video.multi");
}

/** 图改图专用：把模型替换成平台绑定的「图片编辑」模型。 */
export function withPlatformImageEditModel<T extends { model?: string; imageModel?: string }>(config: T): T {
    const model = canvasFeatureModel("image.edit");
    if (!model) return config;
    return { ...config, model, imageModel: model };
}

/**
 * 把平台内置模型写入各模式的默认模型字段。这样新节点默认使用平台模型，
 * 节点上仍可显式选择其他模型。
 */
export function applyPlatformFeatureModels<
    T extends { textModel?: string; imageModel?: string; videoModel?: string; audioModel?: string },
>(config: T): T {
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
    };
}

/** 该模型是否能接收参考图做图片编辑；能力声明优先，模型名只作兜底。 */
export function isImageEditModel(model: string | undefined) {
    const value = String(model || "").trim();
    if (!value) return false;
    if (capabilityImageEditModels.has(value)) return true;
    const name = (value.includes("::") ? value.split("::").pop() || "" : value).toLowerCase();
    if (capabilityImageEditModels.has(name)) return true;
    if (/(^|[^a-z])(i2i|edit|inpaint)([^a-z]|$)/.test(name)) return true;
    // Image G v2.5 低价扩展版在上游支持参考图编辑，旧配置没有 operations 时保留兜底。
    return /(^|[^a-z])g-v2\.5-lowprice$/.test(name);
}

/** 图片编辑类功能解析实际模型：当前档已能编辑则保留，否则回退 image.edit。 */
export function resolveImageEditModel(candidate: string | undefined) {
    const trimmed = String(candidate || "").trim();
    if (isImageEditModel(trimmed)) return trimmed;
    return canvasFeatureModel("image.edit") || trimmed;
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

/** 收集渠道能力中声明 image_to_image 的模型，供图片编辑模型判定。 */
export function collectCapabilityImageEditModels(config: ChannelCapabilityLike | undefined) {
    const models: string[] = [];
    for (const channel of config?.channels || []) {
        for (const profile of channel.modelProfiles || []) {
            if (profile.capability !== "image") continue;
            const operations = profile.capabilityConfig?.image?.operations;
            if (!Array.isArray(operations) || !operations.includes("image_to_image")) continue;
            const name = String(profile.model || "").trim();
            if (!name) continue;
            models.push(name);
            if (channel.id) models.push(`${channel.id}::${name}`);
        }
    }
    capabilityImageEditModels = new Set(models);
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
