import type { CanvasConnection } from "@/types/canvas";

/**
 * Remove only connections that belong exclusively to temporary generation
 * nodes. The target node already exists on the canvas and must retain its
 * reference inputs when a pre-submit save conflict aborts generation.
 */
export function cleanupPendingGenerationConnections(
    connections: CanvasConnection[],
    targetNodeId: string,
    pendingNodeIds: string[],
) {
    const pending = new Set(pendingNodeIds);
    return connections.filter((connection) => {
        const fromPending = pending.has(connection.fromNodeId);
        const toPending = pending.has(connection.toNodeId);
        if (!fromPending && !toPending) return true;
        if (connection.fromNodeId === targetNodeId || connection.toNodeId === targetNodeId) {
            const otherNodeId = connection.fromNodeId === targetNodeId ? connection.toNodeId : connection.fromNodeId;
            return !pending.has(otherNodeId);
        }
        return false;
    });
}
