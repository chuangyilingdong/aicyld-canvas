import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path: string) {
    return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

describe("release regression source contracts", () => {
    test("keeps video model-first selection and automatic mode routing", () => {
        const picker = source("components/model-picker.tsx");
        const selection = source("lib/model-selection.ts");
        expect(picker).toContain('input: requirements.capability === "video" ? undefined : requirements.input');
        expect(selection).toContain("operationForModelSelection");
        expect(selection).toContain("first_last_frame");
    });

    test("keeps the long-duration slider and direct image format picker", () => {
        expect(source("components/video-settings-panel.tsx")).toContain("contiguousDurationRange");
        expect(source("components/canvas/canvas-image-settings-popover.tsx")).toContain("CanvasImageFormatPicker");
        expect(source("components/canvas/canvas-node-prompt-panel.tsx")).toContain("<CanvasImageFormatPicker");
    });

    test("keeps model names free of channel subtitles", () => {
        expect(source("pages/settings/model-default-grid.tsx")).not.toContain("model-default-select-channel");
    });

    test("keeps quote reference counts in the task contract", () => {
        const generation = source("services/api/generation-task.ts");
        expect(generation).toContain("quoteReferenceCounts");
        expect(generation).toContain("quote-image-");
    });
});
