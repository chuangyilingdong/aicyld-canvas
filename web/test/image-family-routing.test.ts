import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig, normalizeImageValue } from "@/lib/model-capabilities";
import { groupImageModelsByFamily, imageModelFamilyLabel, resolveCompatibleModel } from "@/lib/model-selection";
import { encodeChannelModel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

function imageConfig(maxImages: number, formats: string[]) {
    const base = defaultModelCapabilityConfig();
    return {
        ...base,
        image: {
            ...base.image!,
            references: { ...base.image!.references, maxImages },
            outputFormat: { supported: true, values: formats, default: formats[0] },
        },
    };
}

const profiles = [
    { model: "rh-image-t2i", displayName: "gpt-image-2.6/sunburst/text-to-image/stable-token", capabilityConfig: imageConfig(0, ["png", "jpeg", "webp", "gif", "svg"]) },
    { model: "rh-image-i2i", displayName: "gpt-image-2.6/sunburst/image-to-image/stable-token", capabilityConfig: imageConfig(16, ["png", "jpeg", "webp", "gif"]) },
];

const config = {
    channels: [{
        id: "managed",
        name: "系统模型",
        scope: "system",
        baseUrl: "https://example.invalid",
        apiKey: "test",
        apiFormat: "openai",
        models: profiles.map((item) => item.model),
        modelProfiles: profiles.map((item) => ({ ...item, capability: "image" as const })),
    }],
    models: [],
} as unknown as AiConfig;

describe("image model family routing", () => {
    const t2i = encodeChannelModel("managed", "rh-image-t2i");
    const i2i = encodeChannelModel("managed", "rh-image-i2i");
    const input = (imageCount: number) => ({ textCount: 1, imageCount, videoCount: 0, audioCount: 0, characterCount: 0 });

    test("groups split upstream SKUs behind one family", () => {
        const groups = groupImageModelsByFamily(config, selectableModelsByCapability(config, "image"));
        expect(groups).toHaveLength(1);
        expect(groups[0].models).toEqual([t2i, i2i]);
        expect(imageModelFamilyLabel(config, i2i)).toBe("Lib Image 2.6 Pro · Sunburst");
    });

    test("routes by connected reference count", () => {
        expect(resolveCompatibleModel(config, t2i, { capability: "image", input: input(0) })).toBe(t2i);
        expect(resolveCompatibleModel(config, t2i, { capability: "image", input: input(1) })).toBe(i2i);
    });

    test("normalizes output format against the selected upstream", () => {
        const profile = config.channels[0].modelProfiles![1].capabilityConfig!.image!;
        expect(normalizeImageValue(profile, { imageOutputFormat: "svg" }).imageOutputFormat).toBe("png");
        expect(normalizeImageValue(profile, { imageOutputFormat: "webp" }).imageOutputFormat).toBe("webp");
    });
});
