import { afterEach, expect, test } from "bun:test";

import {
    applyPlatformFeatureModels,
    canvasFeatureModel,
    canvasFeatureModelForMode,
    collectCapabilityImageEditModels,
    isImageEditModel,
    setCanvasFeatureModels,
    withPlatformImageEditModel,
} from "../src/lib/canvas/feature-models";

const models = {
    "text.chat": "text::chat-model",
    "image.t2i": "image::t2i-model",
    "image.edit": "image::edit-model",
    "video.t2v": "video::t2v-model",
    "video.i2v": "video::i2v-model",
    "video.multi": "video::multi-model",
    "audio.tts": "audio::tts-model",
    "audio.music": "audio::music-model",
};

afterEach(() => {
    setCanvasFeatureModels({});
    collectCapabilityImageEditModels(undefined);
});

test("feature models route video by the actual input mode", () => {
    setCanvasFeatureModels(models);

    expect(canvasFeatureModelForMode("video")).toBe(models["video.t2v"]);
    expect(canvasFeatureModelForMode("video", { input: { imageCount: 1, videoCount: 0, audioCount: 0, characterCount: 0 } })).toBe(models["video.i2v"]);
    expect(canvasFeatureModelForMode("video", { input: { imageCount: 2, videoCount: 0, audioCount: 0, characterCount: 0 } })).toBe(models["video.i2v"]);
    expect(canvasFeatureModelForMode("video", { input: { imageCount: 0, videoCount: 1, audioCount: 0, characterCount: 0 } })).toBe(models["video.multi"]);
    expect(canvasFeatureModelForMode("video", { input: { imageCount: 3, videoCount: 0, audioCount: 0, characterCount: 0 } })).toBe(models["video.multi"]);
});

test("platform defaults fill each generation mode field", () => {
    setCanvasFeatureModels(models);
    const config = applyPlatformFeatureModels({ textModel: "mine::text", imageModel: "", videoModel: "", audioModel: "" });

    expect(config).toMatchObject({
        textModel: models["text.chat"],
        imageModel: models["image.t2i"],
        videoModel: models["video.t2v"],
        audioModel: models["audio.tts"],
    });
    expect(canvasFeatureModel("audio.music")).toBe(models["audio.music"]);
});

test("image edit routing keeps capability-declared edit models", () => {
    setCanvasFeatureModels(models);
    collectCapabilityImageEditModels({
        channels: [{
            id: "image",
            modelProfiles: [{
                model: "vendor-image-v2.5",
                capability: "image",
                capabilityConfig: { image: { operations: ["text_to_image", "image_to_image"] } },
            }],
        }],
    });

    expect(isImageEditModel("image::vendor-image-v2.5")).toBe(true);
    expect(withPlatformImageEditModel({ model: "image::t2i-model", imageModel: "image::t2i-model" })).toMatchObject({
        model: models["image.edit"],
        imageModel: models["image.edit"],
    });
    expect(isImageEditModel("text::plain-model")).toBe(false);
});
