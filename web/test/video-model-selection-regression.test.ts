import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import {
    displayVideoOperation,
    displayVideoOperations,
    isVideoPromptRequired,
    operationForModelSelection,
    modelCompatibilityError,
    resolveVideoOperation,
    resolveCompatibleModel,
    videoModelFamilyOperations,
    videoOperationInputError,
} from "@/lib/model-selection";
import { encodeChannelModel, type AiConfig } from "@/stores/use-config-store";
import { videoRatioLabel } from "@/components/video-settings-panel";

const base = defaultModelCapabilityConfig();

function videoConfig(operations: string[], defaultOperation: string, maxImages: number): ModelCapabilityConfig {
    return {
        ...base,
        video: {
            ...base.video!,
            operations,
            defaultOperation,
            references: {
                ...base.video!.references,
                minImages: operations.includes("text_to_video") ? 0 : Math.min(1, maxImages),
                maxImages,
            },
        },
    };
}

const models = [
    { model: "rh-minimax-h3-i2v", displayName: "MiniMax-H3 图生视频（首尾帧）", capabilityConfig: videoConfig(["image_to_video", "first_last_frame"], "image_to_video", 2) },
    { model: "rh-minimax-h3-multi", displayName: "MiniMax-H3 多模态参考生视频", capabilityConfig: videoConfig(["reference_to_video"], "reference_to_video", 9) },
    {
        model: "rh-magi-2",
        displayName: "MAGI-2",
        capabilityConfig: {
            ...videoConfig(["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"], "text_to_video", 10),
            video: {
                ...videoConfig(["text_to_video", "image_to_video", "first_last_frame", "reference_to_video"], "text_to_video", 10).video!,
                optionalPromptOperations: ["image_to_video", "first_last_frame"],
                operationReferences: {
                    image_to_video: { minImages: 1, maxImages: 2, maxVideos: 0, maxAudios: 0 },
                    first_last_frame: { minImages: 1, maxImages: 2, maxVideos: 0, maxAudios: 0 },
                    reference_to_video: { minImages: 0, maxImages: 10, maxVideos: 5, maxAudios: 5 },
                },
            },
        },
    },
];

const config = {
    channels: [{
        id: "managed",
        name: "系统模型",
        scope: "system",
        baseUrl: "https://example.invalid",
        apiKey: "test",
        apiFormat: "openai",
        models: models.map((item) => item.model),
        modelProfiles: models.map((item) => ({ ...item, capability: "video" as const })),
    }],
    models: [],
} as unknown as AiConfig;

const values = {
    i2v: encodeChannelModel("managed", "rh-minimax-h3-i2v"),
};

function input(imageCount: number) {
    return { textCount: 1, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 };
}

describe("video model-first selection regression", () => {
    test("shows adaptive ratio in plain Chinese", () => {
        expect(videoRatioLabel("adaptive")).toBe("自适应");
        expect(videoRatioLabel("16:9")).toBe("16:9");
    });

    test("keeps image-only families selectable before media is connected", () => {
        expect(videoModelFamilyOperations(config, values.i2v)).toEqual(["image_to_video", "first_last_frame", "reference_to_video"]);
        expect(operationForModelSelection(config, values.i2v, input(0), "text_to_video")).toBe("image_to_video");
        expect(displayVideoOperation("image_to_video")).toBe("first_last_frame");
        expect(displayVideoOperations(["image_to_video", "first_last_frame"])).toEqual(["first_last_frame"]);
    });

    test("infers video mode from connected references", () => {
        expect(resolveVideoOperation(input(0))).toBe("text_to_video");
        expect(resolveVideoOperation(input(1))).toBe("image_to_video");
        expect(resolveVideoOperation(input(2))).toBe("first_last_frame");
        expect(resolveVideoOperation(input(4))).toBe("reference_to_video");
    });

    test("validates whole-film images as references instead of first and last frames", () => {
        const multi = encodeChannelModel("managed", "rh-minimax-h3-multi");
        const requirements = { capability: "video" as const, input: input(2), videoOperation: "reference_to_video" };
        expect(modelCompatibilityError(config, values.i2v, requirements)).toBeTruthy();
        expect(modelCompatibilityError(config, multi, requirements)).toBe("");
        expect(resolveCompatibleModel(config, values.i2v, requirements)).toBe(multi);
        expect(resolveVideoOperation(input(2), requirements.videoOperation)).toBe("reference_to_video");
    });

    test("keeps the user's explicit mode before media is connected", () => {
        expect(resolveVideoOperation(input(0), "image_to_video")).toBe("image_to_video");
        expect(resolveVideoOperation(input(0), "reference_to_video")).toBe("reference_to_video");
        expect(resolveVideoOperation(input(0), "first_last_frame")).toBe("first_last_frame");
        expect(resolveVideoOperation(input(2), "reference_to_video")).toBe("reference_to_video");
        expect(operationForModelSelection(config, values.i2v, input(0), "first_last_frame")).toBe("first_last_frame");
        expect(videoOperationInputError(input(0), "image_to_video")).toContain("1 张首帧图片");
        expect(videoOperationInputError(input(1), "text_to_video")).toContain("不能同时传入参考素材");
    });

    test("uses MAGI-2's optional prompt and reference routing by mode", () => {
        const magi = encodeChannelModel("managed", "rh-magi-2");
        expect(isVideoPromptRequired(config, magi, "image_to_video")).toBe(false);
        expect(isVideoPromptRequired(config, magi, "first_last_frame")).toBe(false);
        expect(isVideoPromptRequired(config, magi, "text_to_video")).toBe(true);
        expect(isVideoPromptRequired(config, magi, "reference_to_video")).toBe(true);
        expect(operationForModelSelection(config, magi, { ...input(0), audioCount: 1 })).toBe("reference_to_video");
        expect(operationForModelSelection(config, magi, { ...input(1), audioCount: 1 })).toBe("reference_to_video");
        expect(operationForModelSelection(config, magi, input(2), "reference_to_video")).toBe("reference_to_video");
    });
});
