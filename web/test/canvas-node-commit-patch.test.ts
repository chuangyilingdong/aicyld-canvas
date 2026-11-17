import { describe, expect, test } from "bun:test";

import { buildCanvasNodeCommitPatch } from "../src/lib/canvas/canvas-node-commit-patch";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const node = (id: string, title: string): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Text,
    title,
    position: { x: 0, y: 0 },
    width: 200,
    height: 120,
    metadata: { content: title },
});

const project = (nodes: CanvasNodeData[], updatedAt = "2026-11-17T00:00:00.000Z"): CanvasProject => ({
    id: "canvas",
    title: "画布",
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt,
    nodes,
    connections: [],
    chatSessions: [],
    activeChatId: undefined,
    canvasAppearance: undefined,
    backgroundMode: "dots",
    showImageInfo: false,
} as CanvasProject);

describe("canvas node commit patch", () => {
    test("sends only changed nodes when order and non-node fields stay stable", () => {
        const confirmed = project([node("a", "一"), node("b", "二")]);
        const settled = project([node("a", "一"), node("b", "二改")], "2026-11-17T00:01:00.000Z");
        expect(buildCanvasNodeCommitPatch(confirmed, settled)?.map((item) => item.id)).toEqual(["b"]);
    });

    test("falls back to full document for reorder, addition or non-node edits", () => {
        const original = project([node("a", "一"), node("b", "二")]);
        expect(buildCanvasNodeCommitPatch(original, project([node("b", "二"), node("a", "一")]))).toBeNull();
        expect(buildCanvasNodeCommitPatch(original, project([node("a", "一"), node("b", "二"), node("c", "三")]))).toBeNull();
        expect(buildCanvasNodeCommitPatch(original, { ...project([node("a", "一"), node("b", "二改")]), title: "新标题" })).toBeNull();
    });
});
