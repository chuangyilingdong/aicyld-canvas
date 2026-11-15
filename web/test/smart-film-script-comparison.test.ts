import { describe, expect, test } from "bun:test";

import { canCompareSmartFilmScripts, compareSmartFilmScript } from "../src/pages/smart-film/smart-film-script-comparison";

describe("smart film script comparison", () => {
    test("extracts structured creative fields from generated scripts", () => {
        const comparison = compareSmartFilmScript({
            content: "创意方向：痛点共鸣\n开场钩子：早上迟到时也能喝到现磨咖啡\n正文：地铁通勤场景，主角拿出便携咖啡机。\n结尾：品牌名和购买入口",
        });
        expect(comparison).toMatchObject({
            direction: "痛点共鸣",
            hook: "早上迟到时也能喝到现磨咖啡",
            body: "地铁通勤场景，主角拿出便携咖啡机。",
            ending: "品牌名和购买入口",
            structured: true,
        });
        expect(comparison.characters).toBeGreaterThan(30);
    });

    test("keeps legacy scripts readable when structured labels are missing", () => {
        const comparison = compareSmartFilmScript({ content: "旧版剧本：雨夜街角，人物拿起咖啡杯，镜头推向品牌名。" });
        expect(comparison.structured).toBe(false);
        expect(comparison.body).toContain("旧版剧本");
        expect(comparison.direction).toBe("");
    });

    test("allows comparison for two or three selected scripts", () => {
        expect(canCompareSmartFilmScripts([1, 2])).toBe(true);
        expect(canCompareSmartFilmScripts([1, 2, 3])).toBe(true);
        expect(canCompareSmartFilmScripts([1])).toBe(false);
        expect(canCompareSmartFilmScripts([1, 2, 3, 4])).toBe(false);
    });
});
