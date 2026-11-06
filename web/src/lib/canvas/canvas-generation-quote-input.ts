import type { NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { buildBackendGenerationTaskQuoteInput } from "@/services/api/generation-task";

type QuoteReferences = Pick<NodeGenerationContext, "referenceImages" | "referenceVideos" | "referenceAudios">;

/** Quotes the same reference set that will be sent by the real task submission. */
export function buildCanvasGenerationQuoteInput(options: Parameters<typeof buildBackendGenerationTaskQuoteInput>[0], references: QuoteReferences) {
    return buildBackendGenerationTaskQuoteInput({
        ...options,
        referenceImages: references.referenceImages,
        referenceVideos: references.referenceVideos,
        referenceAudios: references.referenceAudios,
    });
}
