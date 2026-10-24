import { afterEach, describe, expect, test } from "bun:test";

import { createUpscaleTask, estimateUpscale, recoverUpscaleTask, UPSCALE_CREATE_TIMEOUT_MS, UPSCALE_ESTIMATE_TIMEOUT_MS, UPSCALE_RECOVER_TIMEOUT_MS } from "../src/services/api/media-upscale";
import { apiClient } from "../src/services/api/request";

const originalRequest = apiClient.request;
const originalWindow = globalThis.window;

afterEach(() => {
    apiClient.request = originalRequest;
    if (originalWindow === undefined) delete (globalThis as unknown as { window?: EventTarget }).window;
    else (globalThis as unknown as { window: EventTarget }).window = originalWindow;
});

describe("媒体超分客户端超时", () => {
    test("报价、创建和原任务恢复使用各自的长请求预算", async () => {
        if (typeof globalThis.window === "undefined") {
            (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
        }
        const requests: Array<{ method?: string; url?: string; timeout?: number }> = [];
        apiClient.request = (async (request) => {
            requests.push({ method: request.method, url: request.url, timeout: request.timeout });
            if (request.url === "/media-upscale/estimate") {
                return {
                    status: 200,
                    data: {
                        code: 0,
                        data: {
                            mediaType: "video",
                            model: "Topaz-Upscale-LowPirce",
                            modelLabel: "Topaz 视频超分",
                            source: { width: 1280, height: 720, durationMs: 115_752 },
                            target: { resolution: "1080p", quality: "Max", outputResolution: "1080p" },
                            unitPriceCnyPerSecond: 0.12,
                            durationSeconds: 115.752,
                            reservationCny: 13.9,
                            currency: "CNY",
                            billing: "actual_output_duration",
                            generationSubmitted: false,
                            cloudProcessing: true,
                        },
                    },
                };
            }
            return {
                status: 200,
                data: {
                    code: 0,
                    data: {
                        id: request.url?.includes("recover") ? "original" : "created",
                        type: "canvas_video",
                        status: "running",
                        prompt: "媒体超分",
                        attempts: 1,
                        createdAt: "2026-10-24T00:00:00Z",
                        updatedAt: "2026-10-24T00:00:00Z",
                    },
                },
            };
        }) as typeof apiClient.request;

        await estimateUpscale({ model: "Topaz-Upscale-LowPirce", resourceId: "resource-1", resolution: "1080p", quality: "Max" });
        await createUpscaleTask({
            model: "Topaz-Upscale-LowPirce",
            resourceId: "resource-1",
            resolution: "1080p",
            quality: "Max",
            clientOperationId: "operation-1",
            projectId: "project-1",
            nodeId: "node-1",
        });
        await recoverUpscaleTask("original");

        expect(UPSCALE_ESTIMATE_TIMEOUT_MS).toBe(120_000);
        expect(UPSCALE_CREATE_TIMEOUT_MS).toBe(30_000);
        expect(UPSCALE_RECOVER_TIMEOUT_MS).toBe(60_000);
        expect(requests).toEqual([
            { method: "post", url: "/media-upscale/estimate", timeout: UPSCALE_ESTIMATE_TIMEOUT_MS },
            { method: "post", url: "/media-upscale/tasks", timeout: UPSCALE_CREATE_TIMEOUT_MS },
            { method: "get", url: "/tasks/original", timeout: UPSCALE_RECOVER_TIMEOUT_MS },
        ]);
    });
});
