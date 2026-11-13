import { queryGenerationTask, retryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { isRegenerateConfirm, type TaskOutcome } from "@/lib/task-outcome";

/**
 * Only replay the original task when its outcome is safe to reuse. A confirmed
 * failure needs a fresh submission: the backend intentionally rejects replaying
 * an uncertain submission, and the user has already accepted the extra charge.
 */
export function shouldReuseStoredVideoTask(outcome?: TaskOutcome | null) {
    return !isRegenerateConfirm(outcome);
}

/** Retry the persisted request, never rebuild a failed video's inputs from the current canvas. */
export async function retryStoredCanvasVideo(taskId: string, signal: AbortSignal, onTaskUpdate: (task: GenerationTask) => void,
    dependencies = { queryGenerationTask, retryGenerationTask, waitForGenerationTask }) {
    const check = () => signal.throwIfAborted();
    let task = await dependencies.queryGenerationTask(taskId, { signal });
    check();
    if (task.type !== "canvas_video") throw new Error("原任务不是画布视频任务，无法按原输入重试");
    if (task.status === "failed" || task.status === "cancelled") {
        task = await dependencies.retryGenerationTask(taskId, { signal });
        check();
    }
    onTaskUpdate(task);
    return dependencies.waitForGenerationTask(task.id, { signal, initialTask: task, onTaskUpdate });
}
