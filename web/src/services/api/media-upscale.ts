import { http } from "./request";
import type { GenerationTask } from "./task-center";

export type UpscaleResolution = "720p" | "1080p" | "2K" | "4K";
export type UpscaleQuality = "Low" | "Medium" | "High" | "Max" | "Ultra";
export type UpscaleBilling = "actual_output_duration" | "fixed_per_request";

export type UpscaleModelCapability = {
    id: string;
    label: string;
    mediaType: "image" | "video";
    billing: UpscaleBilling;
    resolutions?: UpscaleResolution[];
    qualities?: UpscaleQuality[];
    defaultResolution?: UpscaleResolution;
    defaultQuality?: UpscaleQuality;
    fixedPriceCny?: number;
    maxDurationMs?: number;
    minDurationMs?: number;
    outputResolution?: string;
    inputConstraint?: string;
};

export type UpscaleCapabilities = {
    models: UpscaleModelCapability[];
    currency: "CNY";
    cloudProcessing: boolean;
};

export type UpscaleRequest = {
    model: string;
    resourceId: string;
    resolution?: UpscaleResolution;
    quality?: UpscaleQuality;
};

export type UpscaleEstimate = {
    mediaType: "image" | "video";
    model: string;
    modelLabel: string;
    source: { width: number; height: number; durationMs: number };
    target: { resolution?: UpscaleResolution; quality?: UpscaleQuality; outputResolution?: string };
    unitPriceCnyPerSecond: number;
    fixedPriceCny?: number;
    durationSeconds: number;
    reservationCny: number;
    currency: "CNY";
    billing: UpscaleBilling;
    generationSubmitted: false;
    cloudProcessing: boolean;
};

export const getUpscaleCapabilities = () => http.get<UpscaleCapabilities>("/media-upscale/capabilities");

export const estimateUpscale = (request: UpscaleRequest) => http.post<UpscaleEstimate>("/media-upscale/estimate", request).then((quote) => {
    if (quote.currency !== "CNY" || quote.generationSubmitted !== false || !Number.isFinite(quote.reservationCny) || quote.reservationCny <= 0) {
        throw new Error("超分费用未能确认，请重新获取");
    }
    return quote;
});

export function createUpscaleTask(request: UpscaleRequest & {
    clientOperationId: string;
    projectId: string;
    nodeId: string;
}) {
    return http.post<GenerationTask>("/media-upscale/tasks", request).then((task) => {
        window.dispatchEvent(new CustomEvent("canvas:task-created", { detail: { task } }));
        return task;
    });
}
