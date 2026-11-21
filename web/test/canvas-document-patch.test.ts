import { describe, expect, test } from "bun:test";

import { buildCanvasDocumentPatch } from "../src/lib/canvas/canvas-document-patch";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "../src/types/canvas";

function project(overrides: Partial<CanvasProject> = {}): CanvasProject {
    return {
        id: "canvas",
        revision: 3,
        title: "测试画布",
        createdAt: "2026-11-21T00:00:00.000Z",
        updatedAt: "2026-11-21T00:00:00.000Z",
        nodes: [
            { id: "a", type: "text", title: "A", content: "a1", position: { x: 0, y: 0 }, width: 100, height: 100 },
            { id: "b", type: "text", title: "B", content: "b1", position: { x: 200, y: 0 }, width: 100, height: 100 },
        ],
        connections: [{ id: "edge-ab", fromNodeId: "a", toNodeId: "b" }],
        chatSessions: [{ id: "chat", title: "对话", messages: [] }],
        activeChatId: "chat",
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...overrides,
    };
}

function node(source: CanvasProject, id: string): CanvasNodeData {
    return source.nodes.find((item) => item.id === id)!;
}

describe("canvas document patch", () => {
    test("sends only changed nodes with the client's expected base", () => {
        const base = project();
        const live = project({
            nodes: [
                node(base, "a"),
                { ...node(base, "b"), title: "B 本地", content: "b2" },
            ],
        });
        const patch = buildCanvasDocumentPatch(base, live)!;
        expect(patch.baseRevision).toBe(3);
        expect(patch.upsertNodes).toEqual([{ ...node(base, "b"), title: "B 本地", content: "b2" }]);
        expect(patch.expectedNodes).toEqual({ b: node(base, "b") });
        expect(patch.upsertConnections).toBeUndefined();
        expect(patch.upsertChatSessions).toBeUndefined();
    });

    test("supports deletions, connections, chat sessions and top-level fields in one patch", () => {
        const base = project();
        const live = project({
            title: "新标题",
            nodes: [node(base, "b"), { ...node(base, "b"), id: "c", title: "C" }],
            connections: [{ id: "edge-bc", fromNodeId: "b", toNodeId: "c" }],
            chatSessions: [{ id: "chat-2", title: "新对话", messages: [] }],
            activeChatId: "chat-2",
        });
        const patch = buildCanvasDocumentPatch(base, live)!;
        expect(patch.deleteNodeIds).toEqual(["a"]);
        expect(patch.deleteConnectionIds).toEqual(["edge-ab"]);
        expect(patch.deleteChatSessionIds).toEqual(["chat"]);
        expect(patch.upsertNodes?.map((item) => (item as CanvasNodeData).id).sort()).toEqual(["c"]);
        expect(patch.upsertConnections).toEqual(live.connections);
        expect(patch.upsertChatSessions).toEqual(live.chatSessions);
        expect(patch.fields).toEqual({ title: "新标题", activeChatId: "chat-2" });
        expect(patch.expectedFields).toEqual({ title: "测试画布", activeChatId: "chat" });
    });

    test("ignores node timestamps and the open recovery placeholder", () => {
        const base = project({
            nodes: project().nodes.map((item) => item.id === "b"
                ? { ...item, metadata: { status: "loading", errorDetails: "正在从任务中心恢复生成状态..." } }
                : item),
        });
        const live = project({
            nodes: base.nodes.map((item) => ({
                ...item,
                updatedAt: "2026-11-21T01:00:00.000Z",
                ...(item.id === "b" ? { metadata: { status: "loading", errorDetails: "正在从任务中心恢复生成状态..." } } : {}),
            })),
        });
        expect(buildCanvasDocumentPatch(base, live)).toBeNull();
    });

    test("forceHistorySnapshot can intentionally create a standalone snapshot patch", () => {
        const base = project();
        const patch = buildCanvasDocumentPatch(base, project(), { forceHistorySnapshot: true })!;
        expect(patch.forceHistorySnapshot).toBe(true);
        expect(patch.upsertNodes).toBeUndefined();
        expect(patch.fields).toBeUndefined();
    });
});
