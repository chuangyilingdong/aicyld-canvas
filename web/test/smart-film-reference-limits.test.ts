import { describe, expect, test } from "bun:test";

import { SMART_FILM_PLATFORM_REFERENCE_LIMIT, smartFilmScriptReferenceLimit } from "@/pages/smart-film/smart-film-reference-limits";
import type { AiConfig } from "@/stores/use-config-store";

function config(maxImages: number): AiConfig {
    return {
        model: "channel::text-model",
        textModel: "channel::text-model",
        imageModel: "",
        videoModel: "",
        channels: [
            {
                id: "channel",
                models: ["text-model"],
                modelProfiles: [
                    {
                        model: "text-model",
                        capability: "text",
                        capabilityConfig: {
                            version: 1,
                            text: {
                                references: {
                                    promptMaxChars: 32_000,
                                    maxImages,
                                    maxImageBytes: 10_000_000,
                                    maxVideos: 0,
                                    maxVideoBytes: 0,
                                },
                            },
                        },
                    },
                ],
            },
        ],
    } as AiConfig;
}

describe("smart-film reference limits", () => {
    test("uses the selected text model visual limit instead of the platform maximum", () => {
        expect(smartFilmScriptReferenceLimit(config(8), "channel::text-model")).toBe(8);
        expect(smartFilmScriptReferenceLimit(config(3), "channel::text-model")).toBe(3);
    });

    test("treats text-only models as zero-image models and caps oversized limits", () => {
        expect(smartFilmScriptReferenceLimit(config(0), "channel::text-model")).toBe(0);
        expect(smartFilmScriptReferenceLimit(config(30), "channel::text-model")).toBe(SMART_FILM_PLATFORM_REFERENCE_LIMIT);
    });
});
