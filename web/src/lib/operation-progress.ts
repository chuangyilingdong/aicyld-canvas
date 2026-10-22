import { formatBytes } from "@/lib/image-utils";

export type OperationPhase = "preparing" | "transferring" | "processing" | "done" | "error";

export type CanvasOperationTarget = {
    projectId: string;
    nodeId: string;
    taskId?: string;
};

export type OperationProgress = {
    id: string;
    title: string;
    detail: string;
    phase: OperationPhase;
    loadedBytes?: number;
    totalBytes?: number;
    bytesPerSecond?: number;
    completedFiles?: number;
    totalFiles?: number;
    startedAt: number;
    updatedAt: number;
    target?: CanvasOperationTarget;
};

export function canvasNodeOperation(entries: Record<string, OperationProgress>, projectId: string | undefined, nodeId: string, taskId?: string) {
    if (!projectId) return undefined;
    return Object.values(entries)
        .reverse()
        .find((item) => {
            if (!item.target || item.phase === "done" || item.phase === "error") return false;
            if (item.target.projectId !== projectId || item.target.nodeId !== nodeId) return false;
            // During submission the task id is not known yet. Once both ids are
            // known, a stale operation must never cover a newer task on the node.
            return !item.target.taskId || !taskId || item.target.taskId === taskId;
        });
}

const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0;

export const progressBytes = (value: number) => formatBytes(Math.max(0, value)) || "0 B";

export function createTransferSampler(startedAt = Date.now()) {
    let lastLoaded = 0;
    let lastAt = startedAt;
    return (loaded: number, total?: number) => {
        const now = Date.now();
        const safeLoaded = finite(loaded) ? loaded : 0;
        const elapsed = Math.max(1, now - lastAt);
        const instant = Math.max(0, safeLoaded - lastLoaded) * 1000 / elapsed;
        lastLoaded = safeLoaded;
        lastAt = now;
        return {
            loadedBytes: safeLoaded,
            totalBytes: finite(total) && total! > 0 ? total : undefined,
            bytesPerSecond: Math.round(instant),
            updatedAt: now,
        };
    };
}

export function progressDuration(seconds: number) {
    const value = Math.max(0, Math.ceil(seconds));
    if (value < 60) return `${value} 秒`;
    const minutes = Math.floor(value / 60);
    return minutes < 60 ? `${minutes} 分 ${value % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function operationProgressView(progress: OperationProgress, now = Date.now()) {
    const loaded = finite(progress.loadedBytes) ? progress.loadedBytes! : 0;
    const total = finite(progress.totalBytes) && progress.totalBytes! > 0 ? progress.totalBytes! : undefined;
    const percent = total ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : null;
    const speed = finite(progress.bytesPerSecond) && progress.bytesPerSecond! > 0 ? progressBytes(progress.bytesPerSecond!) + "/s" : "";
    const size = total ? progressBytes(loaded) + " / " + progressBytes(total) : loaded > 0 ? progressBytes(loaded) : "";
    const count = progress.totalFiles ? `${progress.completedFiles || 0} / ${progress.totalFiles} 个文件` : "";
    const timing = progress.phase === "done" || progress.phase === "error" ? "" : `已用 ${progressDuration((now - progress.startedAt) / 1000)}`;
    return { percent, size, speed, count, timing };
}
