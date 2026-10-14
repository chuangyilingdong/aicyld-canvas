import { assertUserScope, captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";
import { rebindInconsistentCanvasAssets, type CanvasAssetRebindResult } from "@/services/canvas-asset-repair";
import { createLocalCanvasProject, deleteLocalCanvasProjects, hasUnconfirmedCanvasEdits, openLocalCanvasProject, openLocalCanvasProjectFromBackend, persistCanvasDocument, restoreLocalCanvasProjectFromHistory, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import {
    loadWorkspaceAssetLibraryPage,
    loadWorkspaceAssetsForUse,
    type WorkspaceAssetLibraryPageOptions,
} from "@/services/workspace-asset-read";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";

import { isLocalWorkspaceMode } from "@/services/workspace-mode";

export { isLocalWorkspaceMode } from "@/services/workspace-mode";

let operationTail: Promise<void> = Promise.resolve();
const canvasRefreshListeners = new Set<(project: CanvasProject, previous: CanvasProject | undefined) => void>();

/**
 * Backward-compatible local persistence facade.
 *
 * Call sites keep their historical function names while the implementation
 * contains no account, cloud snapshot, upload queue, conflict baseline or
 * retry machinery. New code should use the workspace repositories directly.
 */
/**
 * 托管部署（hb.aicyld.com.cn）下画布与素材保存在服务端，这里必须为 true；
 * 上游桌面版把云同步桩成了 false，会导致托管模式每次保存都只落浏览器本地。
 */
export function hasRemoteUserDataSyncSession() {
    return !isLocalWorkspaceMode();
}

export function withRemoteUserDataSyncExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationTail.then(operation, operation);
    operationTail = next.then(() => undefined, () => undefined);
    return next;
}

export async function loadCanvasProjectForEditing(
    id: string,
    options: { latest?: boolean; historyRestore?: { snapshotId: string; revision: number }; onLoad?: (project: CanvasProject) => void } = {},
) {
    const expected = captureUserScope();
    assertUserScope(expected);
    if (options.historyRestore) {
        const restored = await restoreLocalCanvasProjectFromHistory(id, options.historyRestore, expected);
        assertUserScope(expected);
        options.onLoad?.(restored);
        return restored;
    }
    const project = await openLocalCanvasProjectFromBackend(id, expected);
    if (project) options.onLoad?.(project);
    return project || undefined;
}

// 画布内容被其他写入者（远端刷新、任务回写）替换后通知本地编辑器合并。
export function subscribeCanvasRefresh(listener: (project: CanvasProject, previous: CanvasProject | undefined) => void) {
    canvasRefreshListeners.add(listener);
    return () => { canvasRefreshListeners.delete(listener); };
}

/** 外部写入已投影到本地存储后，把这次替换交给正在编辑的页面。 */
export function notifyCanvasRefresh(project: CanvasProject, previous: CanvasProject | undefined) {
    for (const listener of [...canvasRefreshListeners]) listener(project, previous);
}

/**
 * Persist an editor snapshot to the co-packaged Go repository. Callers that
 * mutate the canvas outside the autosave flow (for example node deletion) must
 * use this bridge so the next remote refresh cannot resurrect a stale snapshot.
 */
export async function syncLocalCanvasSnapshot(id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "appearance" | "backgroundMode" | "showImageInfo" | "viewport">>, expectedScope?: CapturedUserScope) {
    const expected = expectedScope ?? captureUserScope();
    assertUserScope(expected);
    const current = openLocalCanvasProject(id);
    if (!current) throw new Error("本地画布不存在");
    const { viewport, ...documentPatch } = patch;
    if (viewport) useCanvasStore.getState().updateProject(id, { viewport });
    if (Object.keys(documentPatch).length > 0) await persistCanvasDocument(id, documentPatch, expected);
    assertUserScope(expected);
    const saved = openLocalCanvasProject(id);
    if (!saved) throw new Error("本地画布不存在");
    return saved;
}

export type LocalAssetPageOptions = WorkspaceAssetLibraryPageOptions;

export function loadAssetLibraryPage(options: LocalAssetPageOptions) {
    return loadWorkspaceAssetLibraryPage(options);
}

export function loadAssetsForUse(ids: Iterable<string>, expectedScope?: WorkspaceAssetLibraryPageOptions["expectedScope"]) {
    return loadWorkspaceAssetsForUse(ids, expectedScope);
}

export function localSavedRemotePendingMessage(localAction: string, error: unknown) {
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : "未知错误";
    return `${localAction}失败：${detail}`;
}

export async function createCanvasProjectWithRemoteSync(
    title: string,
    projectId?: string,
    initialContent?: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId">>,
): Promise<{ id: string; syncError?: unknown }> {
    return { ...await createLocalCanvasProject(title, projectId, initialContent), syncError: undefined };
}

export async function deleteAssetWithRemoteSync(id: string) {
    const assetId = id.trim();
    if (!assetId) throw new Error("素材 ID 不能为空");
    await useAssetStore.getState().removeAsset(assetId);
    await flushAssetStorePersistence();
}

export function deleteCanvasProjectsWithRemoteSync(ids: string[]) {
    return deleteLocalCanvasProjects(ids);
}

/**
 * 保存入口：本地存储先落盘；托管部署下再把画布同步到服务端
 * （首次创建走 REST PUT，之后的改动走 canvas.document.commit，带 revision CAS）。
 */
export async function saveRemoteUserDataNow(input?: string | readonly string[] | { force?: boolean }) {
    await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
    if (isLocalWorkspaceMode()) return;
    const ids = typeof input === "string"
        ? [input]
        : Array.isArray(input)
            ? input.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : useCanvasStore.getState().projects.filter((project) => hasUnconfirmedCanvasEdits(project.id)).map((project) => project.id);
    for (const id of ids) {
        // 失败向上抛：调用方会提示「云端同步失败」，本地内容已落盘不会丢。
        await syncLocalCanvasProjectToBackend(id);
    }
}

export function scheduleRemoteUserDataSync() {
    void saveRemoteUserDataNow().catch((error) => console.error("本地工作区保存失败", error));
}

export async function forceOverwriteRemoteCanvasSync(): Promise<CanvasAssetRebindResult> {
    const result = rebindInconsistentCanvasAssets(useAssetStore.getState().assets);
    await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
    if (!isLocalWorkspaceMode()) {
        const ids = useCanvasStore.getState().projects.filter((project) => hasUnconfirmedCanvasEdits(project.id)).map((project) => project.id);
        for (const id of ids) await syncLocalCanvasProjectToBackend(id);
    }
    return result;
}
