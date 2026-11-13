import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { channelModelProfile, encodeChannelModel, modelOptionName, normalizeModelOptionValue, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

// Match the verified video + audio adapter in modelcatalog/media_review.go.
const MEDIA_REVIEW_MODEL = "wand-vega-vl-1.0-flash";

export function mediaReviewModelOptions(config: AiConfig): string[] {
    const options: string[] = [];
    for (const channel of config.channels) {
        if (channel.enabled === false) continue;
        const model = channel.modelAliases?.[MEDIA_REVIEW_MODEL] || MEDIA_REVIEW_MODEL;
        if (!channel.models.includes(model)) continue;
        const profile = channel.modelProfiles?.find((item) => item.model === model);
        if (!profile || profile.capability !== "text" || (profile.protocol?.trim() || "chat-completion") !== "chat-completion") continue;
        options.push(encodeChannelModel(channel.id, model));
    }
    return options;
}

export function normalizeMediaReviewModel(config: AiConfig, value: unknown): string {
    const candidate = normalizeModelOptionValue(value, config.channels);
    return mediaReviewModelOptions(config).includes(candidate) ? candidate : "";
}

/**
 * How many media references of one kind a text model declares it can accept.
 * `null` means the channel has not declared text media capabilities, so the UI
 * must not invent a limit. The verified media-review adapter is treated as
 * supporting one image or video even when older catalogs omit text limits.
 */
export function textMediaReferenceLimit(config: AiConfig, value: string, kind: "image" | "video"): number | null {
    const candidate = normalizeModelOptionValue(value, config.channels);
    if (!candidate) return null;
    if (mediaReviewModelOptions(config).includes(candidate)) return 1;
    const channel = resolveModelChannel(config, candidate);
    const profile = channelModelProfile(channel, modelOptionName(candidate));
    if (!profile?.capabilityConfig?.text) return null;
    const references = modelCapabilityConfigFor(config, candidate).text?.references;
    if (!references) return null;
    return kind === "video" ? references.maxVideos : references.maxImages;
}

/** Pick a text model that can understand the media attached to reverse-prompt nodes. */
export function resolveTextMediaModel(config: AiConfig, kind: "image" | "video"): string {
    const candidates = [
        normalizeMediaReviewModel(config, config.mediaReviewModel),
        ...mediaReviewModelOptions(config),
        ...selectableModelsByCapability(config, "text"),
    ].filter(Boolean);
    const seen = new Set<string>();
    for (const candidate of candidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        const limit = textMediaReferenceLimit(config, candidate, kind);
        if (limit !== null && limit > 0) return candidate;
    }
    return "";
}
