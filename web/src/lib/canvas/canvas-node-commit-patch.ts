import { sameCanvasDocumentValue } from "./canvas-document-equality";

import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

const NON_NODE_VOLATILE_FIELDS = new Set(["nodes", "revision", "updatedAt", "remoteContentHash"]);

function withoutNodes(document: CanvasProject) {
    return Object.fromEntries(Object.entries(document).filter(([key]) => !NON_NODE_VOLATILE_FIELDS.has(key)));
}

/**
 * Returns only changed nodes when the save is an in-place node edit. Order
 * changes, additions, removals and any non-node edit stay on the full document
 * path so the existing three-way merge and ordering rules remain unchanged.
 */
export function buildCanvasNodeCommitPatch(confirmed: CanvasProject | null, settled: CanvasProject): CanvasNodeData[] | null {
    if (!confirmed || confirmed.nodes.length !== settled.nodes.length) return null;
    if (!sameCanvasDocumentValue(withoutNodes(confirmed), withoutNodes(settled))) return null;
    const changed: CanvasNodeData[] = [];
    for (let index = 0; index < settled.nodes.length; index += 1) {
        const before = confirmed.nodes[index];
        const after = settled.nodes[index];
        if (before.id !== after.id) return null;
        if (!sameCanvasDocumentValue(before, after)) changed.push(after);
    }
    return changed.length > 0 ? changed : null;
}
