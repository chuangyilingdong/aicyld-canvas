import { http } from "./request";
import type { GenerationTask } from "./task-center";

export type VideoUpscaleResolution = "720p" | "1080p" | "2K" | "4K";
export type VideoUpscaleQuality = "Low" | "Medium" | "High" | "Max" | "Ultra";

export type VideoUpscaleCapabilities = {
    model: string;
    mediaType: "video";
    resolutions: VideoUpscaleResolution[];
    qualities: VideoUpscaleQuality[];
    defaultResolution: VideoUpscaleResolution;
    defaultQuality: VideoUpscaleQuality;
    maxDurationMs: number;
    currency: "CNY";
    cloudProcessing: boolean;
    billing: "actual_output_duration";
    generationRequired: false;
};

export type VideoUpscaleRequest = {
    resourceId: string;
    resolution: VideoUpscaleResolution;
    quality: VideoUpscaleQuality;
};

export type VideoUpscaleEstimate = {
    mediaType: "video";
    model: string;
    source: { width: number; height: number; durationMs: number };
    target: { resolution: VideoUpscaleResolution; quality: VideoUpscaleQuality };
    unitPriceCnyPerSecond: number;
    durationSeconds: number;
    reservationCny: number;
    currency: "CNY";
    billing: "actual_output_duration";
    generationSubmitted: false;
    cloudProcessing: boolean;
};

export const getVideoUpscaleCapabilities = () => http.get<VideoUpscaleCapabilities>("/media-upscale/capabilities");

export const estimateVideoUpscale = (request: VideoUpscaleRequest) => http.post<VideoUpscaleEstimate>("/media-upscale/estimate", request).then((quote) => {
    if (quote.currency !== "CNY" || quote.generationSubmitted !== false || !Number.isFinite(quote.reservationCny) || quote.reservationCny <= 0) {
        throw new Error("超分费用未能确认，请重新获取");
    }
    return quote;
});

export function createVideoUpscaleTask(request: VideoUpscaleRequest & {
    clientOperationId: string;
    projectId: string;
    nodeId: string;
}) {
    return http.post<GenerationTask>("/media-upscale/tasks", request).then((task) => {
        window.dispatchEvent(new CustomEvent("canvas:task-created", { detail: { task } }));
        return task;
    });
}
