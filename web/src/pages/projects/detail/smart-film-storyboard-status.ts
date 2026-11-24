import type { GenerationTask } from "@/services/api/task-center";

export function storyboardImageTaskState(task: GenerationTask | undefined, ready: boolean, now: number) {
    if (task?.status === "queued" || task?.status === "running") return "generating";
    if (task?.status !== "succeeded" || ready) return "idle";
    if (task.resultState === "FAILED_RETRYABLE" || task.resultState === "FAILED_PERMANENT") return "delivery-failed";
    const finishedAt = Date.parse(task.completedAt || task.updatedAt || task.createdAt);
    if (Number.isFinite(finishedAt) && now - finishedAt > 60_000) return "sync-delayed";
    return "syncing";
}
