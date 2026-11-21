import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import type { AiConfig } from "@/stores/use-config-store";

export const SMART_FILM_PLATFORM_REFERENCE_LIMIT = 12;

/**
 * The script page and the generation request must use the same visual-input
 * limit. A model capability of zero means the model is text-only, not that the
 * UI should keep sending hidden image inputs.
 */
export function smartFilmScriptReferenceLimit(config: AiConfig, model: string): number {
    const configured = Number(modelCapabilityConfigFor(config, model).text?.references?.maxImages);
    if (!Number.isFinite(configured)) return SMART_FILM_PLATFORM_REFERENCE_LIMIT;
    return Math.max(0, Math.min(SMART_FILM_PLATFORM_REFERENCE_LIMIT, Math.trunc(configured)));
}
