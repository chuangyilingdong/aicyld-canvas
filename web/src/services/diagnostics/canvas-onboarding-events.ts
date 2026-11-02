import { scopedLocalStorage } from "@/lib/user-scope";
import type { CanvasStarterPreset } from "@/lib/canvas/canvas-starter";
import { recordDiagnosticEvent } from "./client-diagnostics";
import { recordCanvasOnboardingServerEvent } from "@/services/api/canvas-onboarding";

export type CanvasOnboardingEvent = "canvas_created" | "canvas_opened" | "image_requested" | "video_requested";

const EVENT_PREFIX = "canvas-onboarding:";

function recordOnce(event: CanvasOnboardingEvent, canvasId: string, detail?: string, taskId?: string) {
    if (!canvasId) return;
    const key = `${EVENT_PREFIX}${event}:${canvasId}`;
    try {
        if (scopedLocalStorage.getItem(key) === "1") return;
        scopedLocalStorage.setItem(key, "1");
    } catch {
        // 本地存储不可用时仍保留本次诊断事件。
    }
    recordDiagnosticEvent({
        level: "info",
        category: "action",
        code: `canvas_onboarding_${event}`,
        message: detail || event,
        canvasId,
    });
    void recordCanvasOnboardingServerEvent({ event, canvasId, taskId }).catch(() => undefined);
}

export function recordCanvasStarterCreated(canvasId: string, preset: CanvasStarterPreset) {
    recordOnce("canvas_created", canvasId, `画布已创建：${preset}`);
}

export function recordCanvasOpened(canvasId: string) {
    recordOnce("canvas_opened", canvasId, "画布已打开");
}

export function recordCanvasGenerationRequested(input: { id: string; projectId?: string; type?: string }) {
    if (!input.projectId) return;
    const type = String(input.type || "").toLowerCase();
    if (type.includes("video")) recordOnce("video_requested", input.projectId, `首次视频任务：${input.id}`, input.id);
    else if (type.includes("image")) recordOnce("image_requested", input.projectId, `首次图片任务：${input.id}`, input.id);
}