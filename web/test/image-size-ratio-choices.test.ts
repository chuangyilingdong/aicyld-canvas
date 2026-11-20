import { describe, expect, test } from "bun:test";

import type { ImageCapabilityConfig } from "@/lib/model-capabilities";
import { imageSizePresets, imageSizeRatioChoices } from "@/lib/image-size-presets";

const seedream = {
    references: {
        promptMaxChars: 5000,
        maxImages: 0,
        maxImageBytes: 31_457_280,
        maskSupported: false,
    },
    size: {
        parameter: "size",
        values: ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "1152x2048"],
        default: "auto",
        allowCustom: true,
    },
    quality: { supported: false, values: [], default: "auto" },
    transparentBackground: { supported: false, default: false },
    responseFormat: { supported: false },
    outputFormat: { supported: true },
    maxOutputs: 1,
} satisfies ImageCapabilityConfig;

describe("image size ratio choices", () => {
    test("keeps landscape and portrait ratios discoverable across resolution tiers", () => {
        expect(imageSizeRatioChoices(seedream, "1k").map((item) => item.ratio)).toEqual(["1:1", "3:2", "2:3", "16:9", "9:16"]);
        expect(imageSizeRatioChoices(seedream, "2k").map((item) => item.ratio)).toEqual(["1:1", "3:2", "2:3", "16:9", "9:16"]);
    });

    test("selects the declared 2K pixel size for 16:9 and 9:16", () => {
        const choices = imageSizeRatioChoices(seedream, "1k");
        expect(choices.find((item) => item.ratio === "16:9")?.size).toBe("2048x1152");
        expect(choices.find((item) => item.ratio === "9:16")?.size).toBe("1152x2048");
    });
});

describe("declared ratio contracts", () => {
    test("keeps named ratios instead of reducing 9:21 to an unsupported alias", () => {
        const profile = {
            ...seedream,
            size: { parameter: "aspect_ratio", values: ["1:1", "9:21", "16:9", "9:16"], default: "1:1", allowCustom: false },
            quality: { supported: true, values: ["low", "medium"], default: "medium" },
        } satisfies ImageCapabilityConfig;
        const ratios = imageSizePresets(profile).map((item) => item.ratio);
        expect(ratios).toContain("9:21");
        expect(ratios).not.toContain("3:7");
    });

    test("shows extreme ratios that are explicitly supported by the model", () => {
        const profile = {
            ...seedream,
            size: { parameter: "aspect_ratio", values: ["1:1", "16:9", "9:16", "1:8", "8:1"], default: "1:1", allowCustom: false },
        } satisfies ImageCapabilityConfig;
        expect(imageSizePresets(profile).map((item) => item.ratio)).toEqual(["1:1", "16:9", "9:16", "1:8", "8:1"]);
    });
});
