import { assertUserScope, isUserScopeAbandonedError, type CapturedUserScope } from "@/lib/user-scope-guard";
import { CanvasStaleScopeError } from "@/services/canvas-revision-conflict";
import { persistCanvasDocument } from "@/services/local-workspace-repository";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { CanvasGenerationTargetSaveError } from "./canvas-generation-errors";

export async function persistCanvasGenerationTarget(input: {
    projectId: string;
    nodeId: string;
    signal?: AbortSignal;
    expectedScope: CapturedUserScope;
    /** Live editor snapshot. The store may lag one React update behind a newly created result node. */
    nodes?: CanvasNodeData[];
    connections?: CanvasConnection[];
}, persist: typeof persistCanvasDocument = persistCanvasDocument) {
    const assertCurrent = () => {
        if (input.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
        assertUserScope(input.expectedScope);
    };
    assertCurrent();
    const project = useCanvasStore.getState().openProject(input.projectId);
    const nodes = input.nodes ?? project?.nodes;
    const connections = input.connections ?? project?.connections ?? [];
    if (!nodes?.some((node) => node.id === input.nodeId)) throw new CanvasGenerationTargetSaveError(undefined, "生成节点已不存在，未开始生成");
    if (input.nodes) {
        useCanvasStore.getState().updateProject(input.projectId, { nodes: input.nodes, ...(input.connections ? { connections: input.connections } : {}) });
    }
    try {
        await persist(input.projectId, { nodes, connections }, input.expectedScope);
    } catch (error) {
        if (isUserScopeAbandonedError(error) || error instanceof CanvasStaleScopeError || (error instanceof Error && error.name === "AbortError")) throw error;
        throw new CanvasGenerationTargetSaveError(error);
    }
    assertCurrent();
    const current = useCanvasStore.getState().openProject(input.projectId);
    if (!current?.nodes.some((node) => node.id === input.nodeId)) {
        // 保存期间的删除也必须提交；旧快照的回执不能让节点在下次打开时重现。
        if (current) await persist(input.projectId, { nodes: current.nodes, connections: current.connections }, input.expectedScope);
        throw new CanvasGenerationTargetSaveError(undefined, "生成节点已不存在，未开始生成");
    }
}
