import type { Dispatch, SetStateAction } from "react";

import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

/** Publish submission metadata to the live editor before an autosave or leave flush can read it. */
export function projectCanvasGenerationSubmission(nodesRef: { current: CanvasNodeData[] }, setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>, nodeIds: string[], metadata: CanvasNodeMetadata) {
    const ids = new Set(nodeIds);
    const next = nodesRef.current.map((node) => (ids.has(node.id) ? { ...node, metadata: { ...node.metadata, ...metadata } } : node));
    nodesRef.current = next;
    setNodes(next);
}
