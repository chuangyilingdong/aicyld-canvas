import { useState } from "react";
import { createRoot } from "react-dom/client";

import { CanvasImageFormatPicker } from "@/components/canvas/canvas-image-settings-popover";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ImageSizePicker } from "@/components/image-size-picker";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { canvasThemes } from "@/lib/canvas-theme";
import { imagePresetForRatio, imageSizeConfigWithPresets } from "@/lib/image-size-presets";
import { createModelChannel, defaultConfig, encodeChannelModel } from "@/stores/use-config-store";

const profile = defaultImageCapabilityConfig("openai-image", "gpt-image-2.6");
profile.size = imageSizeConfigWithPresets(profile, [
    imagePresetForRatio("1k", "1:1"),
    imagePresetForRatio("2k", "16:9"),
    imagePresetForRatio("2k", "3:2"),
    imagePresetForRatio("2k", "2:3"),
    imagePresetForRatio("2k", "9:16"),
]);
profile.size.allowCustom = true;
profile.outputFormat = { supported: true, values: ["jpeg", "png", "webp", "gif", "svg"], default: "png" };
profile.advanced = {
    options: [
        { key: "thinkingLevel", label: "思考强度", type: "select", values: ["minimal", "medium", "high"], default: "medium" },
        { key: "frameCount", label: "GIF 帧数", type: "number", min: 2, max: 16, default: "" },
    ],
};
const channel = createModelChannel({
    id: "synthetic-image",
    name: "Synthetic Image",
    baseUrl: "https://example.com",
    apiKey: "not-a-secret",
    interfaceType: "openai-image",
    models: ["gpt-image-2.6"],
    modelProfiles: [{ model: "gpt-image-2.6", protocol: "openai-image", capabilityConfig: { image: profile } }],
});
const model = encodeChannelModel(channel.id, "gpt-image-2.6");
const baseConfig = {
    ...defaultConfig,
    channels: [channel],
    model,
    imageModel: model,
    imageOutputFormat: "gif",
};

function Harness() {
    const [size, setSize] = useState("1024x1024");
    const [quality, setQuality] = useState("high");
    const [outputFormat, setOutputFormat] = useState("gif");
    const [advancedJson, setAdvancedJson] = useState('{"thinkingLevel":"high"}');
    return (
        <main style={{ width: 420, padding: 16, color: "white", background: "#141414" }}>
            <output data-testid="saved-size">{size}</output>
            <output data-testid="saved-quality">{quality}</output>
            <output data-testid="saved-format">{outputFormat}</output>
            <output data-testid="saved-advanced">{advancedJson}</output>
            <ImageSizePicker
                profile={profile}
                size={size}
                quality={quality}
                onChange={(nextSize, nextQuality) => {
                    setSize(nextSize);
                    if (nextQuality !== undefined) setQuality(nextQuality);
                }}
            />
            <CanvasImageFormatPicker
                config={{ ...baseConfig, imageOutputFormat: outputFormat }}
                onConfigChange={(key, value) => {
                    if (key === "imageOutputFormat") setOutputFormat(value);
                }}
            />
            <ImageSettingsPanel
                config={{ ...baseConfig, imageAdvancedJson: advancedJson, imageOutputFormat: outputFormat }}
                onConfigChange={(key, value) => {
                    if (key === "imageAdvancedJson") setAdvancedJson(value);
                }}
                theme={canvasThemes.dark}
                showCount={false}
                showFormat={false}
            />
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<Harness />);
