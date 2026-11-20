import { useState } from "react";
import { createRoot } from "react-dom/client";

import { ImageSizePicker } from "@/components/image-size-picker";
import { defaultImageCapabilityConfig } from "@/lib/model-capabilities";
import { imagePresetForRatio, imageSizeConfigWithPresets } from "@/lib/image-size-presets";

const profile = defaultImageCapabilityConfig("openai-image", "gpt-image-2.6");
profile.size = imageSizeConfigWithPresets(profile, [
    imagePresetForRatio("1k", "1:1"),
    imagePresetForRatio("2k", "16:9"),
]);
profile.size.allowCustom = true;

function Harness() {
    const [size, setSize] = useState("1024x1024");
    const [quality, setQuality] = useState("high");
    return (
        <main style={{ width: 420, padding: 16, color: "white", background: "#141414" }}>
            <output data-testid="saved-size">{size}</output>
            <output data-testid="saved-quality">{quality}</output>
            <ImageSizePicker
                profile={profile}
                size={size}
                quality={quality}
                onChange={(nextSize, nextQuality) => {
                    setSize(nextSize);
                    if (nextQuality !== undefined) setQuality(nextQuality);
                }}
            />
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<Harness />);
