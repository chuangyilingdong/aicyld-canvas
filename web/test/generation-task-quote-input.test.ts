import { describe, expect, test } from "bun:test";

import { buildCanvasGenerationQuoteInput, quoteReferencesFromCanvasReferences } from "@/lib/canvas/canvas-generation-quote-input";
import { buildGenerationQuotePlan, totalGenerationQuotePoints } from "@/lib/canvas/canvas-generation-quote-plan";

describe("buildBackendGenerationTaskQuoteInput", () => {
    test("image batches quote the same number of paid tasks that submission creates", () => {
        const plan = buildGenerationQuotePlan("image", {
            model: "zhenzhen-image-g-v2.5-lowprice",
            imageModel: "zhenzhen-image-g-v2.5-lowprice",
            count: "3",
            channels: [],
        } as any);
        expect(plan.taskCount).toBe(3);
        expect(plan.quoteConfig.count).toBe("1");
        expect(totalGenerationQuotePoints(4, plan.taskCount)).toBe(12);
    });

    test("live composer quote references include every active media type", () => {
        const refs = quoteReferencesFromCanvasReferences([
            { id: "img-ref", nodeId: "image-1", kind: "image", label: "图片1", title: "参考图", storageKey: "resource:image-1", active: true },
            { id: "video-ref", nodeId: "video-1", kind: "video", label: "视频1", title: "参考视频", storageKey: "resource:video-1", mediaUrl: "https://example.invalid/video.mp4", active: true },
            { id: "audio-ref", nodeId: "audio-1", kind: "audio", label: "音频1", title: "参考音频", storageKey: "resource:audio-1", active: true },
            { id: "text-ref", nodeId: "text-1", kind: "text", label: "文本1", title: "参考文本", active: true },
        ], [
            { id: "image-1", type: "image", metadata: { mimeType: "image/png", bytes: 128, naturalWidth: 720, naturalHeight: 1280 } },
            { id: "video-1", type: "video", metadata: { mimeType: "video/mp4", bytes: 256, durationMs: 2000 } },
            { id: "audio-1", type: "audio", metadata: { mimeType: "audio/mpeg", bytes: 64, durationMs: 1000 } },
        ] as any);
        expect(refs.referenceImages.map((item) => item.storageKey)).toEqual(["resource:image-1"]);
        expect(refs.referenceVideos.map((item) => item.storageKey)).toEqual(["resource:video-1"]);
        expect(refs.referenceAudios.map((item) => item.storageKey)).toEqual(["resource:audio-1"]);
    });

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
