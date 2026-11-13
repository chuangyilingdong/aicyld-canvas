import { seedancePortraitModel } from "@/lib/seedance-portrait";
import { normalizeModelOptionValue, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

export function initialWorkbenchModel(config: AiConfig, projectModel: string | undefined, capability: ModelCapability): string {
    const globalModel = capability === "video" ? config.videoModel : config.imageModel;
    if (projectModel) {
        const normalizedProjectModel = normalizeModelOptionValue(projectModel, config.channels);
        if (normalizedProjectModel) {
            // Project defaults are an explicit user choice. Keep the configured channel model
            // even when its capability metadata is incomplete; generation still validates the
            // selected model before submitting.
            return normalizedProjectModel;
        }
        if (seedancePortraitModel(projectModel)) return projectModel;
    }
    if (globalModel && (!projectModel || !seedancePortraitModel(globalModel))) return globalModel;
    return selectableModelsByCapability(config, capability).find((model) => !seedancePortraitModel(model)) || "";
}

// Catalog/default refreshes must not replace a choice the user already made.
export function refreshedWorkbenchModel(current: string, initial: string, sameScope: boolean): string {
    return sameScope && current ? current : initial;
}
