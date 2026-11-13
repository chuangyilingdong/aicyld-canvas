import { expect, test } from "bun:test";
import { mediaReviewModelOptions, normalizeMediaReviewModel, resolveTextMediaModel, textMediaReferenceLimit } from "@/lib/media-review-model";
import { modelCompatibilityError } from "@/lib/model-selection";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "@/stores/use-config-store";
import { mergeManagedBeefAPICatalog, withChannels } from "@/pages/settings/channel-settings-pane";

const model = "wand-vega-vl-1.0-flash";
const managed = createModelChannel({ id: "beefapi", pinned: true, models: [model, "gpt-6-astra"], modelProfiles: [
    { model, capability: "text", protocol: "chat-completion" },
    { model: "gpt-6-astra", capability: "text", protocol: "chat-completion" },
] });
const custom = { ...managed, id: "custom", pinned: false };
const config = { ...defaultConfig, assistantModel: "beefapi::gpt-6-astra", channels: [managed, custom] };

test("media choices require an available video adapter and do not use main assistant restrictions", () => {
    expect(mediaReviewModelOptions(config)).toEqual([`beefapi::${model}`, `custom::${model}`]);
    for (const change of [{ enabled: false }, { models: [] }, { modelProfiles: [] }, { modelProfiles: [{ model, capability: "video" as const, protocol: "newapi" }] }, { modelProfiles: [{ model, capability: "text" as const, protocol: "responses" }] }]) {
        expect(mediaReviewModelOptions({ ...config, channels: [{ ...managed, ...change }] })).toEqual([]);
    }
    expect(normalizeMediaReviewModel(config, "beefapi::gpt-6-astra")).toBe("");
    expect(normalizeMediaReviewModel(config, `missing::${model}`)).toBe("");
    expect(normalizeMediaReviewModel(config, "")).toBe("");
});

test("saved media choice and explicit off survive normalization, reconnect and catalog refresh", () => {
    for (const selection of [`custom::${model}`, "", `missing::${model}`]) {
        const saved = normalizeConfigSnapshot({ config: { ...config, mediaReviewModel: selection } }).config;
        expect(saved.mediaReviewModel).toBe(selection);
        const server = { ...config, mediaReviewModel: `beefapi::${model}` };
        expect(mergeManagedBeefAPICatalog(saved, server, true).mediaReviewModel).toBe(selection);
        expect(mergeManagedBeefAPICatalog(saved, server).mediaReviewModel).toBe(selection);
    }
    const selected = { ...config, mediaReviewModel: `custom::${model}` };
    expect(withChannels(selected, [managed]).mediaReviewModel).toBe("");
    expect(withChannels(selected, [{ ...managed, models: [] }, custom]).mediaReviewModel).toBe(selected.mediaReviewModel);
    expect(normalizeConfigSnapshot({ config: { ...config, mediaReviewModel: undefined } }).config.mediaReviewModel).toBe("");
});

test("catalog aliases are selectable without silently choosing another model", () => {
    const channel = { ...managed, models: ["catalog-wand"], modelAliases: { [model]: "catalog-wand" }, modelProfiles: [{ model: "catalog-wand", capability: "text" as const, protocol: "chat-completion" }] };
    const aliased = { ...config, channels: [channel] };
    expect(mediaReviewModelOptions(aliased)).toEqual(["beefapi::catalog-wand"]);
    expect(normalizeMediaReviewModel(aliased, `beefapi::${model}`)).toBe("beefapi::catalog-wand");
});

test("reverse-prompt model selection prefers a video-capable media model", () => {
    expect(resolveTextMediaModel(config, "video")).toBe(`beefapi::${model}`);
    expect(resolveTextMediaModel(config, "image")).toBe(`beefapi::${model}`);

    const visionModel = "vision-text-model";
    const visionChannel = createModelChannel({
        id: "vision",
        models: [visionModel],
        modelProfiles: [{
            model: visionModel,
            capability: "text",
            protocol: "chat-completion",
            capabilityConfig: {
                version: 1,
                text: { references: { promptMaxChars: 32000, maxImages: 2, maxImageBytes: 10_000_000, maxVideos: 2, maxVideoBytes: 50_000_000 } },
            },
        }],
    });
    const visionConfig = { ...defaultConfig, channels: [visionChannel] };
    expect(resolveTextMediaModel(visionConfig, "video")).toBe(`vision::${visionModel}`);
    expect(textMediaReferenceLimit(visionConfig, `vision::${visionModel}`, "video")).toBe(2);
});

test("text models with zero media references are rejected before submission", () => {
    const textModel = "deepseek-v4.1-flash";
    const textChannel = createModelChannel({
        id: "deepseek",
        models: [textModel],
        modelProfiles: [{
            model: textModel,
            capability: "text",
            protocol: "chat-completion",
            capabilityConfig: {
                version: 1,
                text: { references: { promptMaxChars: 32000, maxImages: 0, maxImageBytes: 0, maxVideos: 0, maxVideoBytes: 0 } },
            },
        }],
    });
    const textConfig = { ...defaultConfig, channels: [textChannel], textModel: `deepseek::${textModel}` };
    const input = { textCount: 1, imageCount: 0, videoCount: 1, audioCount: 0, characterCount: 0 };

    expect(textMediaReferenceLimit(textConfig, `deepseek::${textModel}`, "video")).toBe(0);
    expect(resolveTextMediaModel(textConfig, "video")).toBe("");
    expect(modelCompatibilityError(textConfig, `deepseek::${textModel}`, { capability: "text", input })).toContain("不支持参考视频");
});
