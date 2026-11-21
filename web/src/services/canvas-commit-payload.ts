import { commitCanvasDocument, patchCanvasDocument, patchCanvasNodes, type CanvasDocumentCommitResult, type CanvasDocumentPatchResult, type WorkspaceOperationResult } from "@/services/api/operations";
import type { CanvasCommitPayload } from "@/services/canvas-operation-journal";
import { buildCanvasDocumentPatch } from "@/lib/canvas/canvas-document-patch";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export function prepareCanvasCommitPayload(
    canvasId: string,
    expectedRevision: number,
    confirmed: CanvasProject | null,
    settled: CanvasProject,
): CanvasCommitPayload {
    if (confirmed) {
        const patch = buildCanvasDocumentPatch(confirmed, settled);
        if (patch) {
            return {
                kind: "patch",
                canvasId,
                expectedRevision,
                patch: structuredClone(patch),
                document: structuredClone(settled),
            };
        }
    }
    return {
        kind: "document",
        canvasId,
        expectedRevision,
        document: structuredClone(settled),
    };
}

export function sendCanvasCommitPayload(
    operationId: string,
    payload: CanvasCommitPayload,
): Promise<WorkspaceOperationResult<CanvasDocumentCommitResult | CanvasDocumentPatchResult>> {
    if (payload.kind === "patch") {
        return patchCanvasDocument({
            operationId,
            ...payload.patch,
        });
    }
    return payload.kind === "nodes"
        ? patchCanvasNodes({
            operationId,
            canvasId: payload.canvasId,
            expectedRevision: payload.expectedRevision,
            nodes: payload.nodes as unknown as Record<string, unknown>[],
        })
        : commitCanvasDocument({
            operationId,
            canvasId: payload.canvasId,
            expectedRevision: payload.expectedRevision,
            document: payload.document as unknown as Record<string, unknown>,
        });
}
