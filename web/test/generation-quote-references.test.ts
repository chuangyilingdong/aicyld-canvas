import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { buildBackendGenerationTaskQuoteInput } from "@/services/api/generation-task";
import type { AiConfig } from "@/stores/use-config-store";

const model = "rh-seedance-2.5-flash-i2v";
const config = {
    channelMode: "remote",
    baseUrl: "https://example.invalid",
    apiKey: "test",
    apiFormat: "openai",
    model: `managed::${model}`,
    videoModel: `managed::${model}`,
    imageModel: "",
    textModel: "",
    audioModel: "",
    assistantModel: "",
    mediaReviewModel: "",
    size: "16:9",
    quality: "auto",
    transparentBackground: "false",
    count: "1",
    videoSeconds: "5",
    vquality: "720p",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    audioVoice: "",
    audioFormat: "",
    audioSampleRate: "",
    audioSpeed: "1",
    audioPitch: "0",
    audioVolume: "1",
    channels: [{
        id: "managed",
        name: "系统模型",
        scope: "system",
        baseUrl: "https://example.invalid",
        apiKey: "test",
        apiFormat: "openai",
        interfaceType: "runninghub-standard-video",
        models: [model],
        modelProfiles: [{
            model,
            displayName: "Seedance 2.5 Flash 图生视频",
            capability: "video",
            protocol: "runninghub-standard-video",
            capabilityConfig: {
                ...defaultModelCapabilityConfig(),
                video: {
                    ...defaultModelCapabilityConfig().video!,
                    operations: ["image_to_video", "first_last_frame"],
                    defaultOperation: "image_to_video",
                },
            },
        }],
    }],
    models: [],
    runningHub: { enabled: false, capability: "video", workflowId: "", workflows: [] },
} as unknown as AiConfig;

describe("generation quote reference counts", () => {
    test("keeps reference counts without reading or uploading media", () => {
        const input = buildBackendGenerationTaskQuoteInput({
            mode: "video",
            prompt: "生成",
            config,
            quoteReferenceCounts: { images: 1, videos: 0, audios: 0 },
            metadata: { videoEditOperation: "first_last_frame" },
        });
        expect(input.input.referenceImages).toHaveLength(1);
        expect(input.input.referenceImages?.[0]?.dataUrl).toBe("");
        expect(input.input.referenceImages?.[0]?.storageKey).toBeUndefined();
        expect(input.operation).toBe("first_last_frame");
    });

    test("gives synthetic video and audio placeholders a valid duration", () => {
        const input = buildBackendGenerationTaskQuoteInput({
            mode: "video",
            prompt: "生成",
            config,
            quoteReferenceCounts: { images: 1, videos: 1, audios: 1 },
            metadata: { videoEditOperation: "audio_to_video" },
        });
        expect(input.input.referenceVideos?.[0]?.durationMs).toBe(5_000);
        expect(input.input.referenceAudios?.[0]?.durationMs).toBe(5_000);
    });

    test("quotes an audio-only MAGI reference request as reference-to-video", () => {
        const magiConfig = structuredClone(config);
        const channel = magiConfig.channels[0];
        channel.models = ["rh-magi-2"];
        channel.modelProfiles = [{
            model: "rh-magi-2",
            displayName: "MAGI-2",
            capability: "video",
            protocol: "runninghub-standard-video",
            capabilityConfig: {
                ...defaultModelCapabilityConfig(),
                video: {
                    ...defaultModelCapabilityConfig().video!,
                    operations: ["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"],
                    defaultOperation: "text_to_video",
                    optionalPromptOperations: ["image_to_video", "first_last_frame"],
                },
            },
        }];
        magiConfig.model = "managed::rh-magi-2";
        magiConfig.videoModel = "managed::rh-magi-2";
        const input = buildBackendGenerationTaskQuoteInput({
            mode: "video",
            prompt: "use this voice",
            config: magiConfig,
            quoteReferenceCounts: { images: 0, videos: 0, audios: 1 },
        });
        expect(input.operation).toBe("reference_to_video");
        expect(input.input.metadata?.videoEditOperation).toBe("reference_to_video");
        expect(input.input.referenceAudios).toHaveLength(1);
    });
});
