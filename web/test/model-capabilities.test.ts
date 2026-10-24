import assert from "node:assert/strict";
import test from "node:test";

// Bun 直接执行 TypeScript 测试时需要保留扩展名；生产 tsconfig 不包含 test/。
import { DEFAULT_VIDEO_PROMPT_MAX_CHARS, defaultModelCapabilityConfig, modelCapabilityConfigFor, normalizeVideoValue } from "../src/lib/model-capabilities.ts";
import { modelCompatibilityError, modelPromptLengthError } from "../src/lib/model-selection.ts";
import type { AiConfig } from "../src/stores/use-config-store.ts";

test("FullVideo full models accept one or two image references as well as mixed video references", () => {
    for (const name of ["sd-native-full-2.0", "sd-native-full-2.5", "原生不卡人脸-全参2.0", "原生不卡人脸-全参2.5"]) {
        const config = { channels: [{ id: "fullvideo", baseUrl: "https://video.example.com/v1", models: [name], modelProfiles: [{ model: name, capability: "video", protocol: "full-video" }] }] } as AiConfig;
        for (const [imageCount, videoCount] of [[1, 0], [2, 0], [0, 1], [2, 1]]) {
            assert.equal(modelCompatibilityError(config, `fullvideo::${name}`, {
                capability: "video", videoSeconds: "5",
                input: { textCount: 1, imageCount, videoCount, audioCount: 0, characterCount: 0 },
            }), "");
        }
    }
});

test("switching to MiniMax H3 replaces an unsupported 720p value with 768P", () => {
    const profile = defaultModelCapabilityConfig("minimax-video", "MiniMax-H3").video!;

    assert.deepEqual(normalizeVideoValue(profile, { seconds: "11", ratio: "16:9", resolution: "720" }), {
        seconds: "11",
        ratio: "16:9",
        resolution: "768P",
    });
});

test("video prompt defaults use endpoint contracts", () => {
    assert.equal(DEFAULT_VIDEO_PROMPT_MAX_CHARS, 0);
    const cases = [
        [undefined, "test-model", 0, 0],
        ["seedance-videos-compatible", "test-model", 0, 0],
        ["newapi", "seedance-2.5", 0, 0],
        ["minimax-h3-v2", "MiniMax-H3", 7000, 0],
        ["newapi-channel-2", "minimax-h3-max", 7000, 0],
        ["newapi-channel-2", "wan3.0-video", 20000, 0],
        ["full-video", "sd-native-full-2.5", 4000, 0],
        ["openai-videos", "sora-2-pro", 32000, 0],
        ["runway-video", "gen4_turbo", 0, 1000],
    ] as const;
    for (const [protocol, model, chars, units] of cases) {
        const profile = defaultModelCapabilityConfig(protocol, model).video!;
        assert.equal(profile.references.promptMaxChars, chars, `${protocol}/${model} chars`);
        assert.equal(profile.references.promptMaxUtf16Units || 0, units, `${protocol}/${model} units`);
    }
});

test("video prompt UTF-16 limits are enforced in the frontend", () => {
    const profile = defaultModelCapabilityConfig("runway-video", "gen4_turbo");
    profile.video!.references.promptMaxUtf16Units = 1000;
    const config = { channels: [{ id: "custom", models: ["gen4_turbo"], modelProfiles: [{ model: "gen4_turbo", capability: "video", protocol: "runway-video", capabilityConfig: profile }] }] } as AiConfig;
    assert.equal(modelPromptLengthError(config, "custom::gen4_turbo", "video", "😀".repeat(500)), "");
    assert.match(modelPromptLengthError(config, "custom::gen4_turbo", "video", "😀".repeat(501)), /UTF-16/);
});

test("unpublished video limits remain local-zero without rejecting long prompts", () => {
    const profile = defaultModelCapabilityConfig("newapi", "seedance-2.5");
    const config = { channels: [{ id: "custom", models: ["seedance-2.5"], modelProfiles: [{ model: "seedance-2.5", capability: "video", protocol: "newapi", capabilityConfig: profile }] }] } as AiConfig;
    assert.equal(modelPromptLengthError(config, "custom::seedance-2.5", "video", "镜".repeat(32001)), "");
});

test("raising the video default leaves text and image limits untouched", () => {
    // 只放宽视频默认值，避免顺带改变其它能力的判定口径。
    const profile = defaultModelCapabilityConfig("seedance-videos-compatible", "sd-2.5");
    assert.equal(profile.text!.references.promptMaxChars, 32000);
    assert.equal(profile.image!.references.promptMaxChars, 32000);
});

test("APIMart NewAPI channel exposes Seedance multimodal reference operations", () => {
    const profile = defaultModelCapabilityConfig("newapi-channel-2", "seedance-2.0-fast").video!;
    assert.deepEqual(profile.references.maxVideos, 3);
    assert.ok(profile.operations.includes("reference_to_video"));
    assert.ok(!profile.operations.includes("audio_to_video"));
});

test("BeefAPI generic newapi Seedance accepts mixed image and video references without a persisted capability profile", () => {
    const model = "beefapi::seedance-2.0-fast";
    const config = {
        channels: [{
            id: "beefapi",
            name: "BeefAPI",
            baseUrl: "https://enterprise.beefapi.com",
            apiKey: "test",
            apiFormat: "openai",
            models: ["seedance-2.0-fast"],
            modelProfiles: [{
                model: "seedance-2.0-fast",
                capability: "video",
                protocol: "newapi",
                billingMode: "fixed_request",
                unitPriceMicrocredits: 0,
            }],
        }],
    } as AiConfig;

    const profile = modelCapabilityConfigFor(config, model).video!;
    assert.ok(profile.operations.includes("reference_to_video"));
    assert.ok(profile.references.maxVideos >= 1);
    assert.equal(modelCompatibilityError(config, model, {
        capability: "video",
        input: { textCount: 1, imageCount: 1, videoCount: 1, audioCount: 0, characterCount: 0 },
        videoSeconds: "5",
    }), "");
});
