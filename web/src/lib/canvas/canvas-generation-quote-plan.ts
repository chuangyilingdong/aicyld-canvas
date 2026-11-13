import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";
import { normalizeImageValue } from "@/lib/model-capabilities";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { getGenerationCount } from "@/lib/canvas/canvas-project-generation";

export type GenerationQuotePlan = {
    quoteConfig: AiConfig;
    taskCount: number;
};

/**
 * Maps the visible canvas outputs to the paid task shape actually submitted.
 * Non-native image batches submit one count=1 task per output, so the quote
 * must not round a combined batch as a single request.
 */
export function buildGenerationQuotePlan(mode: CanvasGenerationMode, config: AiConfig): GenerationQuotePlan {
    if (mode !== "image") return { quoteConfig: config, taskCount: 1 };
    const profile = mergedImageCapabilityConfig(config, config.model || config.imageModel);
    const nativeOutputCount = profile.fixedOutputs || 0;
    const count = nativeOutputCount
        ? Number(normalizeImageValue(profile, config).count)
        : getGenerationCount(config.count);
    const totalOutputs = Number.isFinite(count) && count > 0 ? Math.max(1, Math.floor(count)) : 1;
    const taskCount = nativeOutputCount > 0 ? Math.max(1, Math.ceil(totalOutputs / nativeOutputCount)) : totalOutputs;
    return {
        quoteConfig: { ...config, count: String(nativeOutputCount || 1) },
        taskCount,
    };
}

export function totalGenerationQuotePoints(points: number, taskCount: number) {
    const normalizedCount = Number.isFinite(taskCount) ? Math.max(1, Math.floor(taskCount)) : 1;
    return Math.max(0, points) * normalizedCount;
}
