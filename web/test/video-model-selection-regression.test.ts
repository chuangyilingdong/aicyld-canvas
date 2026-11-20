import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import {
    displayVideoOperation,
    displayVideoOperations,
    operationForModelSelection,
    resolveVideoOperation,
    videoModelFamilyOperations,
} from "@/lib/model-selection";
import { encodeChannelModel, type AiConfig } from "@/stores/use-config-store";

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
    test("keeps image-only families selectable before media is connected", () => {
        expect(videoModelFamilyOperations(config, values.i2v)).toEqual(["image_to_video", "first_last_frame", "reference_to_video"]);
        expect(operationForModelSelection(config, values.i2v, input(0), "text_to_video")).toBe("image_to_video");
        expect(displayVideoOperation("image_to_video")).toBe("first_last_frame");
        expect(displayVideoOperations(["image_to_video", "first_last_frame"])).toEqual(["first_last_frame"]);
    });

    test("infers video mode from connected references", () => {
        expect(resolveVideoOperation(input(0), "text_to_video")).toBe("text_to_video");
        expect(resolveVideoOperation(input(1), "text_to_video")).toBe("image_to_video");
        expect(resolveVideoOperation(input(2), "image_to_video")).toBe("first_last_frame");
        expect(resolveVideoOperation(input(4), "text_to_video")).toBe("reference_to_video");
    });
});
