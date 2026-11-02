import { http } from "@/services/api/request";

export type CanvasOnboardingEventName = "canvas_created" | "canvas_opened" | "image_requested" | "video_requested";

export type CanvasOnboardingEventInput = {
    event: CanvasOnboardingEventName;
    canvasId: string;
    taskId?: string;
};

export type CanvasOnboardingFunnelRow = {
    event: CanvasOnboardingEventName;
    count: number;
    users: number;
};

export type CanvasOnboardingFunnelResponse = {
    from: string;
    to: string;
    events: CanvasOnboardingFunnelRow[];
};

export function recordCanvasOnboardingServerEvent(input: CanvasOnboardingEventInput) {
    return http.post<{ recorded: boolean }>("/canvas-onboarding/events", input);
}

export function getCanvasOnboardingFunnel(from: string, to: string) {
    const params = new URLSearchParams({ from, to });
    return http.get<CanvasOnboardingFunnelResponse>(`/admin/canvas-onboarding/funnel?${params.toString()}`);
}