import { http } from "@/services/api/request";

export type SmartFilmScriptStatus = "draft" | "project_created" | "assets_extracted" | "storyboard_ready" | "needs_attention" | "failed";

export type SmartFilmBatchConfig = {
    aspectRatio: string;
    stylePresetId?: string;
    styleProfileJson?: string;
    defaultTextModel?: string;
    defaultImageModel?: string;
    defaultVideoModel?: string;
    scriptCount: number;
    shotCount: number;
    shotDurationSeconds: number;
    shotDurationsSeconds?: number[];
};

export type SmartFilmScript = {
    id: string;
    title: string;
    content: string;
    status: SmartFilmScriptStatus;
    projectId?: string;
    unitId?: string;
    taskId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

export type SmartFilmProductionRun = {
    id: string;
    batchId: string;
    scriptId: string;
    idempotencyKey: string;
    status: "pending" | "ready" | "needs_attention" | "failed" | "skipped";
    currentStep: string;
    resources: {
        projectId?: string;
        unitId?: string;
        linkedAssetIds: string[];
    };
    failedStep?: string;
    error?: string;
    recoverableAction?: "retry_confirm" | "retry_assets" | "retry_storyboard";
    assetStatus: "pending" | "waiting" | "queued" | "running" | "ready" | "confirmed" | "needs_attention";
    assetTaskId?: string;
    assetCount: number;
    storyboardStatus: "pending" | "waiting" | "queued" | "running" | "ready" | "needs_attention";
    storyboardTaskId?: string;
    storyboardShotCount: number;
    controlStatus: "active" | "paused" | "skipped";
    attempts: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type SmartFilmBatch = {
    id: string;
    title: string;
    sourceText: string;
    inputAssetIds: string[];
    config: SmartFilmBatchConfig;
    scripts: SmartFilmScript[];
    productionRuns: SmartFilmProductionRun[];
    status: "draft" | "confirmed" | "partially_confirmed";
    paused: boolean;
    budgetPoints: number;
    control: {
        currentRunId?: string;
        currentProjectId?: string;
        waitingRunIds: string[];
        queuedCount: number;
        runningCount: number;
    };
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export type SmartFilmBatchList = {
    batches: SmartFilmBatch[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
};

export type SmartFilmScriptInput = {
    id?: string;
    title: string;
    content: string;
    taskId?: string;
};

export function createSmartFilmBatch(input: {
    title: string;
    sourceText: string;
    inputAssetIds: string[];
    config: SmartFilmBatchConfig;
    orchestrationConfig?: Record<string, unknown>;
    budgetPoints?: number;
}) {
    return http.post<{ batch: SmartFilmBatch }>("/smart-film-batches", input);
}

export function getSmartFilmBatch(batchId: string, signal?: AbortSignal) {
    return http.get<{ batch: SmartFilmBatch }>(`/smart-film-batches/${encodeURIComponent(batchId)}`, { signal });
}

export function listSmartFilmBatches(input: { status?: "" | "draft" | "confirmed" | "partially_confirmed"; page?: number; pageSize?: number } = {}) {
    return http.get<SmartFilmBatchList>("/smart-film-batches", { params: input });
}

export function deleteSmartFilmBatch(batchId: string) {
    return http.delete<{ deleted: boolean }>(`/smart-film-batches/${encodeURIComponent(batchId)}`);
}

export function updateSmartFilmBatchBudget(batchId: string, budgetPoints: number) {
    return http.patch<{ batch: SmartFilmBatch }>(`/smart-film-batches/${encodeURIComponent(batchId)}/budget`, { budgetPoints });
}

export type SmartFilmBatchCostItem = {
    key: string;
    label: string;
    stage: "storyboard" | "video" | string;
    count: number;
    points: number;
    enabled: boolean;
};

export type SmartFilmBatchCost = {
    enabled: boolean;
    budgetPoints: number;
    committedPoints: number;
    estimatedPoints: number;
    totalPoints: number;
    overBudget: boolean;
    balance: number;
    items: SmartFilmBatchCostItem[];
};

export function getSmartFilmBatchCosts(batchId: string) {
    return http.get<SmartFilmBatchCost>(`/smart-film-batches/${encodeURIComponent(batchId)}/costs`);
}

export function saveSmartFilmBatchScripts(batchId: string, scripts: SmartFilmScriptInput[], expectedRevision: number) {
    return http.put<{ batch: SmartFilmBatch }>(`/smart-film-batches/${encodeURIComponent(batchId)}/scripts`, { scripts, expectedRevision });
}

export function updateSmartFilmBatchScript(batchId: string, scriptId: string, input: {
    title: string;
    content: string;
    status?: SmartFilmScriptStatus;
    taskId?: string;
    expectedRevision: number;
}) {
    return http.patch<{ batch: SmartFilmBatch }>(
        `/smart-film-batches/${encodeURIComponent(batchId)}/scripts/${encodeURIComponent(scriptId)}`,
        input,
    );
}

export function deleteSmartFilmBatchScript(batchId: string, scriptId: string, expectedRevision: number) {
    return http.delete<{ batch: SmartFilmBatch }>(
        `/smart-film-batches/${encodeURIComponent(batchId)}/scripts/${encodeURIComponent(scriptId)}`,
        { params: { expectedRevision: String(expectedRevision) } },
    );
}

export function confirmSmartFilmBatchScripts(batchId: string, scriptIds: string[], expectedRevision: number) {
    return http.post<{ batch: SmartFilmBatch }>(`/smart-film-batches/${encodeURIComponent(batchId)}/confirm`, {
        scriptIds,
        expectedRevision,
    });
}

export function checkpointSmartFilmProductionRun(batchId: string, runId: string, input: {
    stage: "assets" | "storyboard";
    status: "pending" | "waiting" | "queued" | "running" | "ready" | "needs_attention";
    taskId?: string;
    error?: string;
    resourceCount?: number;
}) {
    return http.patch<{ run: SmartFilmProductionRun }>(
        `/smart-film-batches/${encodeURIComponent(batchId)}/production-runs/${encodeURIComponent(runId)}`,
        input,
    );
}

export function startSmartFilmProductionStage(batchId: string, runId: string, stage: "assets" | "storyboard") {
    return http.post<{ run: SmartFilmProductionRun }>(
        `/smart-film-batches/${encodeURIComponent(batchId)}/production-runs/${encodeURIComponent(runId)}/start`,
        { stage },
    );
}

export function controlSmartFilmBatch(batchId: string, action: "pause" | "resume") {
    return http.patch<{ batch: SmartFilmBatch }>(`/smart-film-batches/${encodeURIComponent(batchId)}/control`, { action });
}

export function controlSmartFilmProductionRun(batchId: string, runId: string, action: "pause" | "resume" | "skip" | "retry", stage?: "assets" | "storyboard") {
    return http.patch<{ run: SmartFilmProductionRun }>(
        `/smart-film-batches/${encodeURIComponent(batchId)}/production-runs/${encodeURIComponent(runId)}/control`,
        { action, ...(stage ? { stage } : {}) },
    );
}
