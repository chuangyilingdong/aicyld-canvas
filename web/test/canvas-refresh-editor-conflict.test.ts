import { beforeEach, describe, expect, mock, test } from "bun:test";

const stored = new Map<string, string>();
const server = { document: null as Record<string, unknown> | null, revision: 0, posts: [] as Array<{ expectedRevision?: number }> };
type RefreshListener = (project: never, previous: never) => void;
const refreshListeners = new Set<RefreshListener>();

class ApiError extends Error {
    status?: number;
    reason?: string;
}

mock.module("@/lib/localforage-storage", () => {
    const storage = {
        getItem: async (name: string) => stored.get(name) ?? null,
        setItem: async (name: string, value: string) => { stored.set(name, value); },
        removeItem: async (name: string) => { stored.delete(name); },
    };
    return { localForageStorageForScope: () => storage, localForageStorage: storage };
});

mock.module("@/services/api/request", () => ({
    ApiError,
    apiBaseURL: "/api",
    compactApiParams: (params: Record<string, unknown>) => params,
    http: {
        get: async () => ({ project: server.document }),
        put: async (_path: string, body: { project: Record<string, unknown> }) => {
            server.revision += 1;
            server.document = { ...body.project, revision: server.revision };
            return { project: { id: String(body.project.id), revision: server.revision, updatedAt: "2026-01-01T00:00:00.000Z" } };
        },
        post: async (_path: string, body: { opId?: string; params?: { canvasId?: string; expectedRevision?: number; document?: Record<string, unknown> } }) => {
            server.revision += 1;
            server.posts.push({ expectedRevision: body.params?.expectedRevision });
            server.document = { ...body.params?.document, revision: server.revision };
            return { op: "canvas.document.commit", opId: body.opId, replayed: false, caller: "manual", revision: server.revision, result: { canvasId: "c1", revision: server.revision, updatedAt: "2026-01-01T00:00:00.000Z" } };
        },
    },
}));

// Same contract as the real module: the repository notifies, the editor listens.
mock.module("@/services/local-workspace-sync", () => ({
    notifyCanvasRefresh: (project: never, previous: never) => {
        for (const listener of [...refreshListeners]) listener(project, previous);
    },
    isLocalWorkspaceMode: () => true,
}));

mock.module("@/services/canvas-sync-drafts", () => ({
    preserveCanvasSyncDraft: async () => 1,
    readCanvasSyncDrafts: async () => [],
    readAllCanvasSyncDrafts: async () => [],
}));

mock.module("@/stores/use-asset-store", () => ({
    useAssetStore: { getState: () => ({ assets: [] }) },
    flushAssetStorePersistence: async () => {},
}));

mock.module("@/services/workspace-mode", () => ({ isLocalWorkspaceMode: () => true }));

mock.module("@/services/api/resources", () => ({
    resourceIdFromStorageKey: () => "",
    resourceFileUrl: () => "",
}));

const {
    acceptExternalCanvasRevision,
    holdExternalCanvasRevisionForEditor,
    reconcilePausedCanvasSubmit,
    refreshLocalCanvasProjectIfChanged,
    resetLocalCanvasBackendSaveState,
    syncLocalCanvasProjectToBackend,
} = await import("@/services/local-workspace-repository");
const { mergeCanvasRefreshPatch } = await import("@/lib/canvas/canvas-patch-merge");
const { canvasExternalRevisionConflict, clearCanvasExternalRevisionConflict, useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
const { canvasBackendSubmitPaused, pauseCanvasBackendSubmit } = await import("@/services/canvas-revision-conflict");
const { getActiveUserScope } = await import("@/lib/user-scope");
const { useSyncProgressStore } = await import("@/stores/use-sync-progress-store");
const { resetCanvasOperationJournalMemory } = await import("@/services/canvas-operation-journal");
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";

const scope = getActiveUserScope();

function textNode(id: string, title: string): CanvasNodeData {
    return { id, type: "text", title, position: { x: 0, y: 0 }, width: 240, height: 120, metadata: { content: title } } as CanvasNodeData;
}

function canvas(revision: number, nodes: CanvasNodeData[]): CanvasProject {
    return {
        id: "c1",
        revision,
        title: "画布",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "grid",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    } as CanvasProject;
}

const stamp = (node: CanvasNodeData): CanvasNodeData => ({ ...node, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

/** The refresh step of use-canvas-project-lifecycle, against an editor graph held in memory. */
function mountEditor(initial: CanvasNodeData[]) {
    const editor = { nodes: initial, held: 0 };
    const listener = (project: CanvasProject, previous: CanvasProject | undefined) => {
        try {
            editor.nodes = previous ? mergeCanvasRefreshPatch(previous, project, editor.nodes, []).nodes : project.nodes;
        } catch {
            editor.held += 1;
            holdExternalCanvasRevisionForEditor(project);
        }
    };
    refreshListeners.add(listener as RefreshListener);
    return editor;
}

const assistantNodes = [textNode("a1", "助手文本一"), textNode("a2", "助手文本二")];

async function confirmedAssistantCanvas() {
    server.document = canvas(0, assistantNodes) as never;
    server.revision = 0;
    useCanvasStore.setState({ projects: [canvas(0, assistantNodes)] });
    await syncLocalCanvasProjectToBackend("c1");
}

beforeEach(() => {
    stored.clear();
    refreshListeners.clear();
    resetCanvasOperationJournalMemory();
    resetLocalCanvasBackendSaveState();
    server.posts = [];
    useSyncProgressStore.getState().clearAll();
    clearCanvasExternalRevisionConflict(scope, "c1");
    useCanvasStore.setState({ projects: [] });
});

describe("外部撤销到达编辑器", () => {
    test("编辑器副本只多了节点时间戳：删除照常落到编辑器，不暂停保存", async () => {
        await confirmedAssistantCanvas();
        const editor = mountEditor(assistantNodes.map(stamp));
        server.document = canvas(2, []) as never;

        await refreshLocalCanvasProjectIfChanged("c1");

        expect(editor.held).toBe(0);
        expect(editor.nodes).toEqual([]);
        expect(useCanvasStore.getState().projects[0].nodes).toEqual([]);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
    });

    test("编辑器里有真实冲突：保留本地画面，顶栏出现最新版本，自动提交暂停", async () => {
        await confirmedAssistantCanvas();
        const editor = mountEditor([{ ...stamp(assistantNodes[0]), title: "用户刚改的标题" }, stamp(assistantNodes[1])]);
        server.document = canvas(2, []) as never;

        await refreshLocalCanvasProjectIfChanged("c1");

        expect(editor.held).toBe(1);
        expect(editor.nodes.map((node) => node.title)).toEqual(["用户刚改的标题", "助手文本二"]);
        const conflict = canvasExternalRevisionConflict(scope, "c1");
        expect(conflict?.remoteRevision).toBe(2);
        expect(conflict?.candidate.nodes).toEqual([]);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);

        // The next autosave of the stale editor graph must not reach the server.
        useCanvasStore.getState().updateProject("c1", { nodes: editor.nodes });
        await expect(syncLocalCanvasProjectToBackend("c1")).rejects.toThrow();
        expect(server.posts).toEqual([]);
        expect(server.document?.nodes).toEqual([]);

        // 「使用最新版本」：编辑器回到服务端内容，自动提交恢复。
        await acceptExternalCanvasRevision("c1");
        expect(editor.nodes).toEqual([]);
        expect(useCanvasStore.getState().projects[0].nodes).toEqual([]);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
    });
});

describe("冲突暂停自愈（画布不再静默地只在本地累积）", () => {
    test("服务端新增节点、本地另有编辑：三路合并自愈，恢复自动提交并补一次提交", async () => {
        await confirmedAssistantCanvas();
        // 本地未确认编辑：用户自己加了一个节点。
        useCanvasStore.getState().updateProject("c1", { nodes: [...assistantNodes, textNode("local1", "本地新节点")] });
        // 同时服务端也前进了一个 revision（生成结果/别的入口加的节点）。
        server.revision = 2;
        server.document = canvas(2, [...assistantNodes, textNode("remote1", "服务端新节点")]) as never;
        // 等价于顶栏「画布已在别处更新」的暂停态：本地内容还在，但自动提交已经停了。
        pauseCanvasBackendSubmit("c1", scope);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(true);

        const recovered = await reconcilePausedCanvasSubmit("c1");

        expect(recovered).toBe(true);
        expect(canvasBackendSubmitPaused("c1", scope)).toBe(false);
        expect(canvasExternalRevisionConflict(scope, "c1")).toBeUndefined();
        // 两边的内容都要在：本地的节点保留，服务端新增的节点也采纳。
        expect(useCanvasStore.getState().projects[0].nodes.map((node) => node.id).sort()).toEqual(["a1", "a2", "local1", "remote1"]);
        // 自愈不是"只恢复标记"：合并结果必须真的补交到服务端，且用服务端当前 revision 作为基线。
        expect(server.posts).toEqual([{ expectedRevision: 2 }]);
        expect((server.document?.nodes as CanvasNodeData[] | undefined)?.map((node) => node.id).sort()).toEqual(["a1", "a2", "local1", "remote1"]);
    });

    test("同一节点两边都改过：不猜胜者，保持暂停交回用户选择", async () => {
        await confirmedAssistantCanvas();
        useCanvasStore.getState().updateProject("c1", { nodes: [{ ...assistantNodes[0], title: "用户刚改的标题" }, assistantNodes[1]] });
        server.revision = 2;
        server.document = canvas(2, [textNode("a1", "服务端也改了"), assistantNodes[1]]) as never;
        pauseCanvasBackendSubmit("c1", scope);

        const recovered = await reconcilePausedCanvasSubmit("c1");

        expect(recovered).toBe(false);
        expect(server.posts).toEqual([]);
        expect(useCanvasStore.getState().projects[0].nodes[0].title).toBe("用户刚改的标题");
    });
});
