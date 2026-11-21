import type { useEffectiveConfig } from "@/stores/use-config-store";
import type { SmartFilmBatch, SmartFilmScriptStatus } from "@/services/api/smart-film-batches";

export function smartFilmBatchModelConfig(batch: SmartFilmBatch, effectiveConfig: ReturnType<typeof useEffectiveConfig>) {
    const textModel = batch.config.defaultTextModel || effectiveConfig.textModel;
    return { ...effectiveConfig, model: textModel, textModel, imageModel: batch.config.defaultImageModel || effectiveConfig.imageModel, videoModel: batch.config.defaultVideoModel || effectiveConfig.videoModel };
}

export function smartFilmScriptStatusColor(status: SmartFilmScriptStatus) {
    if (status === "storyboard_ready") return "green";
    if (status === "assets_extracted") return "cyan";
    if (status === "project_created") return "blue";
    if (status === "needs_attention" || status === "failed") return "red";
    return "default";
}
