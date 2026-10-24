import { afterEach, describe, expect, test } from "bun:test";

import { apiClient } from "../src/services/api/request";
import { GENERATION_QUOTE_TIMEOUT_MS, quoteGenerationTask } from "../src/services/api/task-billing";
import type { CreateTaskInput } from "../src/services/api/task-center";

const originalRequest = apiClient.request;

afterEach(() => {
    apiClient.request = originalRequest;
});

describe("积分报价请求超时", () => {
    test("使用独立的 15 秒预算，避免被默认 4 秒截断", async () => {
        let timeout: number | undefined;
        apiClient.request = (async (request) => {
            timeout = request.timeout;
            return {
                status: 200,
                data: {
                    code: 0,
                    data: {
                        enabled: true,
                        points: 2,
                        modelKey: "zhenzhen-image-nb-pro-lowprice",
                        balance: 49,
                    },
                },
            };
        }) as typeof apiClient.request;

        const input: CreateTaskInput = {
            type: "canvas_image",
            operation: "image",
            prompt: "报价测试",
            model: "aicyld-seedance::zhenzhen-image-nb-pro-lowprice",
            input: { mode: "image" },
        };
        await quoteGenerationTask(input);

        expect(GENERATION_QUOTE_TIMEOUT_MS).toBe(15_000);
        expect(timeout).toBe(GENERATION_QUOTE_TIMEOUT_MS);
    });
});
