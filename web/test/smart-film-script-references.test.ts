import { describe, expect, test } from "bun:test";

import { smartFilmScriptReferenceBundle } from "@/pages/smart-film/smart-film-script-references";
import type { ImageAsset } from "@/stores/use-asset-store";

function asset(id: string, title: string, storageKey = `resource:${id}`): ImageAsset {
    return {
        id,
        kind: "image",
        title,
        coverUrl: "",
        tags: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        data: {
            dataUrl: "",
            storageKey,
            width: 1024,
            height: 1024,
            bytes: 2048,
            mimeType: "image/png",
        },
    };
}

describe("smart-film script reference bundle", () => {
    test("keeps the visual inputs in prompt order and preserves editable names", () => {
        const bundle = smartFilmScriptReferenceBundle([asset("ship", "原始巡洋舰"), asset("captain", "原始人物")], { ship: "风暴巡洋舰", captain: "舰长" }, { ship: "product", captain: "character" });

        expect(bundle.references).toEqual([
            { title: "风暴巡洋舰", role: "product", imageIndex: 1 },
            { title: "舰长", role: "character", imageIndex: 2 },
        ]);
        expect(bundle.referenceImages.map((image) => ({ name: image.name, storageKey: image.storageKey }))).toEqual([
            { name: "风暴巡洋舰", storageKey: "resource:ship" },
            { name: "舰长", storageKey: "resource:captain" },
        ]);
    });

    test("falls back to a prop role for stale or unknown role values", () => {
        const bundle = smartFilmScriptReferenceBundle([asset("prop", "杯子")], {}, { prop: "unknown-role" });
        expect(bundle.references[0]?.role).toBe("prop");
    });
});
