import { useAppUpdateSafetyStore } from "@/stores/use-app-update-safety-store";
import { useOperationProgress } from "@/stores/use-operation-progress";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";

export type AppReleaseManifest = {
    version: string;
    commit: string;
    buildTime: string;
    buildId: string;
    files?: string[];
};

const UPDATE_CHECK_MIN_MS = 10 * 60 * 1000;
const UPDATE_CHECK_JITTER_MS = 5 * 60 * 1000;
const UPDATE_RELOAD_ATTEMPT_KEY = "infinite-canvas:app-update-reload-attempt";

function compiledAppVersion() {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

export function currentAppBuildId() {
    const configured = import.meta.env.VITE_APP_BUILD_ID?.trim();
    if (configured) return configured;
    return `${import.meta.env.VITE_APP_VERSION || compiledAppVersion()}:${import.meta.env.VITE_BUILD_COMMIT || "unknown"}`;
}

export function parseAppReleaseManifest(value: unknown): AppReleaseManifest | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const version = typeof record.version === "string" ? record.version.trim() : "";
    const commit = typeof record.commit === "string" ? record.commit.trim() : "";
    const buildTime = typeof record.buildTime === "string" ? record.buildTime.trim() : "";
    if (!version || !commit || !buildTime) return null;
    const buildId = typeof record.buildId === "string" && record.buildId.trim()
        ? record.buildId.trim()
        : `${version}:${commit}:${buildTime}`;
    const files = Array.isArray(record.files)
        ? record.files.filter((item): item is string => typeof item === "string" && item.length > 0)
        : undefined;
    return { version, commit, buildTime, buildId, ...(files ? { files } : {}) };
}

export async function fetchAppRelease(
    fetcher: typeof fetch = fetch,
    path = "/version.json",
): Promise<AppReleaseManifest> {
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetcher(`${path}${separator}t=${Date.now()}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`新版本信息读取失败（HTTP ${response.status}）`);
    const manifest = parseAppReleaseManifest(await response.json());
    if (!manifest) throw new Error("新版本信息格式无效");
    return manifest;
}

export function appUpdateCheckDelayMs(random = Math.random) {
    return UPDATE_CHECK_MIN_MS + Math.floor(Math.min(1, Math.max(0, random())) * UPDATE_CHECK_JITTER_MS);
}

export function isNewAppRelease(currentBuildId: string, release: AppReleaseManifest) {
    return Boolean(currentBuildId && release.buildId && currentBuildId !== release.buildId);
}

export function activeCanvasIdFromPath(pathname = typeof location === "undefined" ? "" : location.pathname) {
    const match = /^\/canvas\/([^/?#]+)\/?$/u.exec(pathname);
    if (!match) return "";
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

export function projectHasLiveGeneration(project: { nodes?: Array<{ metadata?: Record<string, unknown> | null }> } | null | undefined) {
    return Boolean(project?.nodes?.some((node) => {
        const metadata = node.metadata || {};
        return metadata.status === "loading"
            || metadata.generationSubmissionState === "submitting"
            || metadata.generationSubmissionState === "unknown"
            || metadata.taskStatus === "queued"
            || metadata.taskStatus === "running";
    }));
}

function environmentUpdateBlockReason() {
    const external = Object.values(useAppUpdateSafetyStore.getState().blockers)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (external) return external.reason;

    const operation = Object.values(useOperationProgress.getState().entries)
        .find((item) => item.phase !== "done" && item.phase !== "error");
    if (operation) return `正在处理「${operation.title}」`;

    const syncing = Object.values(useSyncProgressStore.getState().syncingProjects)
        .find((item) => item.phase === "pending" || item.phase === "uploading" || item.phase === "saving");
    if (syncing) return syncing.message || "画布还在保存";
    return "";
}

/** Returns a user-facing reason when an automatic update reload must wait. */
export async function appUpdateBlockReason() {
    const environmentReason = environmentUpdateBlockReason();
    if (environmentReason) return environmentReason;

    const canvasId = activeCanvasIdFromPath();
    if (!canvasId) return "";
    const [{ hasActiveCanvasStorePersistence, useCanvasStore }, { hasUnconfirmedCanvasEdits }] = await Promise.all([
        import("@/stores/canvas/use-canvas-store"),
        import("@/services/local-workspace-repository"),
    ]);
    if (hasActiveCanvasStorePersistence()) return "画布本地内容还在写入";
    if (hasUnconfirmedCanvasEdits(canvasId)) return "画布还有未保存的修改";
    if (projectHasLiveGeneration(useCanvasStore.getState().openProject(canvasId))) return "画布上还有生成任务正在运行";
    return "";
}

/** False means this tab already attempted the same update moments ago. */
export function beginAppUpdateReloadAttempt(buildId: string, now = Date.now(), storage: Storage | undefined = typeof sessionStorage === "undefined" ? undefined : sessionStorage) {
    if (!storage) return true;
    try {
        const raw = storage.getItem(UPDATE_RELOAD_ATTEMPT_KEY);
        if (raw) {
            const previous = JSON.parse(raw) as { buildId?: unknown; at?: unknown };
            if (previous.buildId === buildId && typeof previous.at === "number" && now - previous.at < 60_000) return false;
        }
        storage.setItem(UPDATE_RELOAD_ATTEMPT_KEY, JSON.stringify({ buildId, at: now }));
    } catch {
        // Storage can be unavailable in hardened browser modes; reloading is still safe.
    }
    return true;
}
