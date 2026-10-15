import type { Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { http, compactApiParams, type HttpRequestConfig } from "@/services/api/request";

export type AssetFolder = {
    id: string;
    name: string;
    position: number;
    createdAt: string;
    updatedAt: string;
};

export type CanvasLibrarySummary = Pick<CanvasProject, "id" | "workspaceProjectId" | "projectId" | "folderId" | "title" | "revision" | "createdAt" | "updatedAt"> & {
    nodeCount: number;
    previewNodes: CanvasProject["nodes"];
};

export function listWorkspaceCanvasProjectsPage(options: { page: number; pageSize: number; projectId?: string; query?: string; sort?: string; signal?: AbortSignal }) {
    return http.get<{ projects: CanvasLibrarySummary[]; page: number; pageSize: number; total: number; hasMore: boolean }>("/canvas-projects", {
        signal: options.signal,
        // ui/lp/fd 是排障用的：服务端忽略它们，但 nginx 日志能看出「用户跑的是哪个构建、
        // 本地缓存里有多少画布/文件夹」——排查「改了没生效 / 界面与服务端不一致」时省一轮往返。
        params: compactApiParams({ page: options.page, pageSize: options.pageSize, projectId: options.projectId, q: options.query, sort: options.sort, ...canvasLibraryDiagnostics() }),
    });
}

function canvasLibraryDiagnostics() {
    try {
        const state = useCanvasStore.getState();
        return { ui: import.meta.env.VITE_CANVAS_BUILD_STAMP || "dev", lp: state.projects.length, fd: state.folders.length };
    } catch {
        return {};
    }
}

export function listAssetFolders(config?: HttpRequestConfig) {
    return http.get<{ folders: AssetFolder[] }>("/asset-folders", config);
}

export function createAssetFolder(name: string, config?: HttpRequestConfig) {
    return http.post<{ folder: AssetFolder }>("/asset-folders", { name }, config);
}

export function updateAssetFolder(id: string, name: string, config?: HttpRequestConfig) {
    return http.patch<{ folder: AssetFolder }>(`/asset-folders/${encodeURIComponent(id)}`, { name }, config);
}

export function deleteAssetFolder(id: string, config?: HttpRequestConfig) {
    return http.delete<{ id: string }>(`/asset-folders/${encodeURIComponent(id)}`, config);
}

export type CanvasLibraryFolderRecord = {
    id: string;
    name: string;
    coverResourceId?: string;
    createdAt: string;
    updatedAt: string;
};

export type CanvasDrawingRenderRecord = {
    resourceId?: string;
    pageId?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    background?: "white";
    storageKey?: string;
};

export type CanvasDrawingRecord = {
    drawingId: string;
    engine: "excalidraw";
    revision: number;
    snapshot?: unknown;
    shapeCount: number;
    pageCount: number;
    previewResourceId?: string;
    render?: CanvasDrawingRenderRecord;
    createdAt: string;
    updatedAt: string;
};

export function listCanvasLibraryFolders(config?: HttpRequestConfig) {
    return http.get<{ folders: CanvasLibraryFolderRecord[] }>("/canvas-folders", config);
}

export function putCanvasLibraryFolder(id: string, folder: { id: string; name: string; coverResourceId?: string; createdAt?: string; updatedAt?: string }, config?: HttpRequestConfig) {
    return http.put<{ folder: CanvasLibraryFolderRecord }>(`/canvas-folders/${encodeURIComponent(id)}`, { folder }, config);
}

export function deleteCanvasLibraryFolder(id: string, config?: HttpRequestConfig) {
    return http.delete<{ id: string }>(`/canvas-folders/${encodeURIComponent(id)}`, config);
}

export function getCanvasDrawing(canvasId: string, drawingId: string, config?: HttpRequestConfig) {
    return http.get<{ drawing: CanvasDrawingRecord }>(`/canvas-projects/${encodeURIComponent(canvasId)}/drawings/${encodeURIComponent(drawingId)}`, config);
}

export function putCanvasDrawing(canvasId: string, drawingId: string, drawing: {
    drawingId: string;
    engine: "excalidraw";
    revision: number;
    snapshot: unknown;
    shapeCount: number;
    pageCount: number;
    previewResourceId?: string;
    render?: CanvasDrawingRenderRecord;
}, config?: HttpRequestConfig) {
    return http.put<{ drawing: CanvasDrawingRecord }>(`/canvas-projects/${encodeURIComponent(canvasId)}/drawings/${encodeURIComponent(drawingId)}`, { drawing }, config);
}

export function deleteCanvasDrawing(canvasId: string, drawingId: string, config?: HttpRequestConfig) {
    return http.delete<{ id: string }>(`/canvas-projects/${encodeURIComponent(canvasId)}/drawings/${encodeURIComponent(drawingId)}`, config);
}

export function moveAssetsToFolder(assetIds: string[], folderId = "", config?: HttpRequestConfig) {
    return http.patch<{ assetIds: string[]; folderId: string }>("/assets/folder", { assetIds, folderId }, config);
}

export function getWorkspaceAsset(id: string, signal?: AbortSignal, config?: HttpRequestConfig) {
    return http.get<{ asset: Asset }>(`/assets/${encodeURIComponent(id)}`, { signal, ...config });
}

export type WorkspaceAssetSummary = {
    id: string;
    folderId?: string;
    kind?: string;
    category?: string;
    status?: string;
    title: string;
    createdAt: string;
    updatedAt: string;
};

export function putWorkspaceAsset(id: string, asset: Asset, config?: HttpRequestConfig) {
    return http.put<{ asset: WorkspaceAssetSummary }>(`/assets/${encodeURIComponent(id)}`, { asset }, config);
}

export function deleteWorkspaceAssetRecord(id: string, config?: HttpRequestConfig) {
    return http.delete<{ id: string }>(`/assets/${encodeURIComponent(id)}`, config);
}

export type CanvasHistoryEntry = {
    id: string;
    canvasId: string;
    revision: number;
    title: string;
    nodeCount: number;
    connectionCount: number;
    payloadBytes: number;
    reason: "automatic" | "before_restore";
    createdAt: string;
    contentUpdatedAt: string;
};

export function listCanvasHistory(id: string, signal?: AbortSignal) {
    return http.get<{ snapshots: CanvasHistoryEntry[]; currentRevision: number }>(`/canvas-projects/${encodeURIComponent(id)}/history`, { signal });
}

export function getCanvasHistoryEntry(id: string, snapshotId: string, signal?: AbortSignal) {
    return http.get<{ snapshot: CanvasHistoryEntry; project: CanvasProject }>(`/canvas-projects/${encodeURIComponent(id)}/history/${encodeURIComponent(snapshotId)}`, { signal });
}

export type CanvasHistoryRestoreSummary = Pick<CanvasProject, "id" | "title" | "createdAt" | "updatedAt"> & {
    revision: number;
};

export function restoreCanvasHistory(id: string, snapshotId: string, revision: number, config?: HttpRequestConfig) {
    return http.post<{ project: CanvasHistoryRestoreSummary }>(
        `/canvas-projects/${encodeURIComponent(id)}/history/${encodeURIComponent(snapshotId)}/restore`,
        { revision },
        config,
    );
}
