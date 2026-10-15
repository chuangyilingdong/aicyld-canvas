import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { createLocalCanvasProject, deleteLocalCanvasProjects } from "@/services/local-workspace-repository";
import { createCanvasProjectWithRemoteSync, deleteCanvasProjectsWithRemoteSync } from "@/services/local-workspace-sync";
import { invalidateCanvasLibraryQueries } from "@/services/canvas-library-cache";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

type InitialCanvasContent = Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">>;

/**
 * Single project-storage boundary for workspace UI code.
 * Local mode writes only to the local repository; hosted mode keeps the
 * existing remote-sync implementation and its retry semantics.
 */
export async function createWorkspaceCanvasProject(title: string, projectId?: string, initialContent?: InitialCanvasContent, workspaceProjectId?: string) {
    if (isLocalWorkspaceMode()) {
        const local = await createLocalCanvasProject(title, projectId, initialContent, workspaceProjectId);
        invalidateCanvasLibraryQueries();
        return { ...local, syncError: undefined as undefined };
    }
    const created = await createCanvasProjectWithRemoteSync(title, projectId, initialContent);
    if (workspaceProjectId) useCanvasStore.getState().updateProject(created.id, { workspaceProjectId });
    invalidateCanvasLibraryQueries();
    return created;
}

export async function deleteWorkspaceCanvasProjects(ids: readonly string[]) {
    const result = isLocalWorkspaceMode() ? await deleteLocalCanvasProjects(ids) : await deleteCanvasProjectsWithRemoteSync([...ids]);
    // 服务端已经删掉了，但列表/首页读的是服务端查询：不失效缓存的话卡片会留在屏幕上
    // （用户报的「画布删除不了」就是这个）。放在这里是为了覆盖全部删除入口。
    invalidateCanvasLibraryQueries();
    return result;
}
