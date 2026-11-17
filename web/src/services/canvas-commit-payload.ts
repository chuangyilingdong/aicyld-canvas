import { commitCanvasDocument, patchCanvasNodes, type CanvasDocumentCommitResult, type WorkspaceOperationResult } from "@/services/api/operations";
import type { CanvasCommitPayload } from "@/services/canvas-operation-journal";
import { buildCanvasNodeCommitPatch } from "@/lib/canvas/canvas-node-commit-patch";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

export function prepareCanvasCommitPayload(
    canvasId: string,
    expectedRevision: number,
    confirmed: CanvasProject | null,
    settled: CanvasProject,
): CanvasCommitPayload {
    const changedNodes = buildCanvasNodeCommitPatch(confirmed, settled);
    if (!changedNodes) {
        return {
            kind: "document",
            canvasId,
            expectedRevision,
            document: structuredClone(settled),
        };
    }
    return {
        kind: "nodes",
        canvasId,
        expectedRevision,
        nodes: structuredClone(changedNodes),
    };
}

export function sendCanvasCommitPayload(operationId: string, payload: CanvasCommitPayload): Promise<WorkspaceOperationResult<CanvasDocumentCommitResult>> {
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
