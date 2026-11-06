import type { NodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
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

/** Mirrors the media reference set shown in the node composer for live price display. */
export function quoteReferencesFromCanvasReferences(references: CanvasResourceReference[], nodes: CanvasNodeData[]): QuoteReferences {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const seen = new Set<string>();
    const referenceImages: ReferenceImage[] = [];
    const referenceVideos: ReferenceVideo[] = [];
    const referenceAudios: ReferenceAudio[] = [];
    for (const reference of references) {
        if (!reference.active || reference.kind === "text" || reference.kind === "skill") continue;
        const node = nodesById.get(reference.nodeId);
        const metadata = node?.metadata;
        const storageKey = reference.storageKey || metadata?.storageKey;
        const key = `${reference.kind}:${reference.nodeId}:${storageKey || reference.mediaUrl || ""}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (reference.kind === "image" || reference.kind === "character") {
            referenceImages.push({
                id: reference.nodeId,
                name: reference.title || reference.label,
                type: metadata?.mimeType || "image/png",
                dataUrl: "",
                storageKey,
                url: reference.mediaUrl,
                bytes: metadata?.bytes,
                width: metadata?.naturalWidth,
                height: metadata?.naturalHeight,
            });
            continue;
        }
        if (reference.kind === "video") {
            referenceVideos.push({
                id: reference.nodeId,
                name: reference.title || reference.label,
                type: metadata?.mimeType || "video/mp4",
                url: reference.mediaUrl || metadata?.content || "",
                storageKey,
                bytes: metadata?.bytes,
                width: metadata?.naturalWidth,
                height: metadata?.naturalHeight,
                durationMs: metadata?.durationMs || reference.videoPreviewSource?.metadata?.durationMs,
            });
            continue;
        }
        if (reference.kind === "audio") {
            referenceAudios.push({
                id: reference.nodeId,
                name: reference.title || reference.label,
                type: metadata?.mimeType || "audio/mpeg",
                url: reference.mediaUrl || metadata?.content || "",
                storageKey,
                bytes: metadata?.bytes,
                durationMs: metadata?.durationMs,
            });
        }
    }
    return { referenceImages, referenceVideos, referenceAudios };
}
