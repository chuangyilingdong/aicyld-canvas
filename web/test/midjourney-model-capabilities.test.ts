import { expect, test } from "bun:test";

import { imageQualityLabel } from "../src/components/image-settings-panel";
import { defaultImageCapabilityConfig, normalizeImageValue } from "../src/lib/model-capabilities";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

test("Midjourney imagine 只暴露比例与速度档，并把 fast 原值送入任务配置", () => {
    const profile = defaultImageCapabilityConfig("midjourney", "midjourney-imagine");
    expect(profile.size).toMatchObject({ parameter: "aspect_ratio", allowCustom: false, default: "1:1" });
    expect(profile.quality).toEqual({ supported: true, values: ["relax", "fast", "turbo"], default: "relax" });
    expect(profile.maxOutputs).toBe(1);
    expect(normalizeImageValue(profile, { size: "16:9", quality: "fast", count: "4" })).toMatchObject({ size: "16:9", quality: "fast", count: "1" });

    const channel = createModelChannel({
        id: "platform", name: "Platform", baseUrl: "https://api.seedance.nz", apiKey: "system", interfaceType: "openai",
        models: ["midjourney-imagine"],
        modelProfiles: [{ model: "midjourney-imagine", capability: "image", protocol: "midjourney", capabilityConfig: { version: 1, image: profile } }],
    });
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "platform::midjourney-imagine", imageModel: "platform::midjourney-imagine", size: "16:9", quality: "fast" } }).config;
    expect(backendProviderConfig(config)).toMatchObject({ interfaceType: "midjourney", model: "midjourney-imagine", size: "16:9", quality: "fast" });
    expect(imageQualityLabel("relax")).toBe("放松");
    expect(imageQualityLabel("fast")).toBe("快速");
    expect(imageQualityLabel("turbo")).toBe("极速");
});
