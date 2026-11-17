import { expect, test } from "bun:test";
import { beefAPIVideoContract } from "../src/lib/beefapi-video-contracts";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { isValidSmartFilmShotCount, normalizeSmartFilmShotCount, normalizeSmartFilmShotSeconds, resizeSmartFilmShotDurations, smartFilmMaxClipSeconds } from "../src/lib/canvas/smart-film-options";
import { smartFilmScriptPrompt } from "../src/lib/canvas/smart-film-scripts";

test("seedance 2.5 flash multi uses the declared references and resolution tiers", () => {
    const contract = beefAPIVideoContract("seedance-2.5-flash-multi");
    expect(contract?.protocol).toBe("newapi");
    expect(contract?.maxReferences).toEqual({ image: 10, video: 5, audio: 5 });
    expect(contract?.resolutions).toEqual(["480p", "720p"]);
});

test("smart film script prompt preserves product, character and scene reference roles", () => {
    const prompt = smartFilmScriptPrompt({
        idea: "做三条独立咖啡机短视频",
        references: [
            { title: "便携咖啡机", role: "product" },
            { title: "通勤女生", role: "character" },
            { title: "清晨厨房", role: "scene" },
        ],
        count: 3,
    });

    expect(prompt).toContain("产品参考：便携咖啡机");
    expect(prompt).toContain("人物参考：通勤女生");
    expect(prompt).toContain("场景参考：清晨厨房");
    expect(prompt).toContain("不要把所有参考图都写成产品");
    expect(prompt).toContain("痛点共鸣、场景故事、结果证明");
    expect(prompt).toContain("创意方向：");
    expect(prompt).toContain("开场钩子：");
    expect(prompt).not.toContain("用户提供的产品参考图：便携咖啡机、通勤女生、清晨厨房");
});
test("smart film keeps per-shot duration inside the selected video model limit", () => {
    const video = defaultModelCapabilityConfig("openai-videos").video!;
    video.duration = { selection: "enum", values: [4, 6, 8], default: 6 };

    expect(smartFilmMaxClipSeconds(video)).toBe(8);
    expect(normalizeSmartFilmShotSeconds(9, video)).toBe(8);
    expect(resizeSmartFilmShotDurations([4], 4, video)).toEqual([4, 6, 6, 6]);
});

test("smart film accepts a custom shot count across the backend range", () => {
    const video = defaultModelCapabilityConfig("openai-videos").video!;
    video.duration = { selection: "enum", values: [5, 10], default: 5 };

    expect(normalizeSmartFilmShotCount(12)).toBe(12);
    expect(normalizeSmartFilmShotCount(null)).toBe(6);
    expect(normalizeSmartFilmShotCount(0)).toBe(1);
    expect(normalizeSmartFilmShotCount(201)).toBe(200);
    expect(isValidSmartFilmShotCount(12)).toBe(true);
    expect(isValidSmartFilmShotCount(0)).toBe(false);
    expect(isValidSmartFilmShotCount(20.5)).toBe(false);
    expect(resizeSmartFilmShotDurations([5], 25, video)).toHaveLength(25);
    expect(resizeSmartFilmShotDurations([5], 201, video)).toHaveLength(200);
});
