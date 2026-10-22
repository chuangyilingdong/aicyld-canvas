import { expect, test } from "bun:test";
import type { AxiosProgressEvent } from "axios";

import { setActiveUserScope } from "../src/lib/user-scope";
import { submitBackendGenerationTask } from "../src/services/api/generation-task";
import { apiClient } from "../src/services/api/request";
import type { GenerationTask } from "../src/services/api/task-center";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";

test("本地参考图上传会向前端上报真实字节与确认阶段", async () => {
    setActiveUserScope("reference-progress-owner");
    const adapter = apiClient.defaults.adapter;
    const channel = createModelChannel({ id: "progress", name: "Progress", baseUrl: "https://provider.example", apiKey: "fixture", interfaceType: "openai-image", models: ["image-test"] });
    const reported: Array<{ label: string; phase: string; loadedBytes: number; totalBytes: number }> = [];
    try {
        apiClient.defaults.adapter = async (config) => {
            if (config.url === "/resources") {
                config.onUploadProgress?.({ loaded: 6, total: 12 } as AxiosProgressEvent);
                return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { resource: { id: "uploaded-reference" } } } };
            }
            throw new Error(`unexpected upload request: ${config.url}`);
        };

        await submitBackendGenerationTask({
            mode: "image",
            prompt: "test",
            config: { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "image-test") },
            referenceImages: [{ id: "one", name: "local.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }],
            onReferenceProgress: (progress) => reported.push(progress),
        }, {
            createTask: async () => ({ id: "accepted" } as GenerationTask),
            waitTask: async () => { throw new Error("must not poll"); },
            createId: () => "unused",
        });

        expect(reported[0]).toMatchObject({ label: "local.png", phase: "transferring", loadedBytes: 0 });
        expect(reported.at(-1)).toMatchObject({ label: "local.png", phase: "processing" });
        expect(reported.at(-1)!.loadedBytes).toBe(reported.at(-1)!.totalBytes);
    } finally {
        apiClient.defaults.adapter = adapter;
    }
});
