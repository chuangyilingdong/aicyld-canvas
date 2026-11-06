import { describe, expect, test } from "bun:test";

import { buildCanvasGenerationQuoteInput } from "@/lib/canvas/canvas-generation-quote-input";

describe("buildBackendGenerationTaskQuoteInput", () => {
    test("keeps reference counts and resource identities without uploading media", () => {
        const config = {
            channelMode: "remote",
            baseUrl: "https://api.seedance.nz",
            apiKey: "",
            apiFormat: "openai",
            model: "aicyld-seedance::seedance-2.0-standard",
            videoModel: "aicyld-seedance::seedance-2.0-standard",
            imageModel: "",
            textModel: "",
            audioModel: "",
            videoSeconds: "4",
            vquality: "720p",
            videoGenerateAudio: "true",
            videoWatermark: "false",
            size: "9:16",
            channels: [
                {
                    id: "aicyld-seedance",
                    name: "灵动TV 平台模型",
                    baseUrl: "https://api.seedance.nz",
                    apiKey: "system",
                    apiFormat: "openai",
                    enabled: true,
                    models: ["seedance-2.0-standard"],
                    modelProfiles: [
                        {
                            model: "seedance-2.0-standard",
                            displayName: "Seedance 2.0",
                            capability: "video",
                            protocol: "newapi",
                            providerModelKey: "seedance-2.0-standard-t2v",
                            variants: [
                                { selector: { operation: "reference_to_video" }, providerModelKey: "seedance-2.0-standard-multi" },
                            ],
                        },
                    ],
                },
            ],
        };

        const input = buildCanvasGenerationQuoteInput({
            projectId: "canvas-1",
            mode: "video",
            prompt: "参考图生成视频",
            config: config as any,
            metadata: { videoEditOperation: "reference_to_video" },
        }, {
            referenceImages: [
                {
                    id: "image-1",
                    name: "reference.png",
                    type: "image/png",
                    dataUrl: "data:image/png;base64,c2VjcmV0",
                    storageKey: "resource:image-1",
                    bytes: 128,
                    width: 720,
                    height: 1280,
                },
            ],
            referenceVideos: [
                {
                    id: "video-1",
                    name: "reference.mp4",
                    type: "video/mp4",
                    url: "https://example.invalid/reference.mp4",
                    bytes: 256,
                    durationMs: 2000,
                },
            ],
            referenceAudios: [
                {
                    id: "audio-1",
                    name: "reference.mp3",
                    type: "audio/mpeg",
                    url: "https://example.invalid/reference.mp3",
                    storageKey: "resource:audio-1",
                    bytes: 64,
                    durationMs: 1800,
                },
            ],
        });

        expect(input.operation).toBe("reference_to_video");
        expect(input.input.referenceImages).toHaveLength(1);
        expect(input.input.referenceVideos).toHaveLength(1);
        expect(input.input.referenceAudios).toHaveLength(1);
        expect(input.input.referenceImages?.[0]?.dataUrl).toBe("");
        expect(input.input.referenceImages?.[0]?.storageKey).toBe("resource:image-1");
        expect(input.input.referenceVideos?.[0]?.url).toBe("https://example.invalid/reference.mp4");
        expect(input.input.referenceAudios?.[0]?.storageKey).toBe("resource:audio-1");
    });
});
