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

    test("keeps video modes selectable before media and validates on submit", () => {
        const promptPanel = source("components/canvas/canvas-node-prompt-panel.tsx");
        const configPanel = source("components/canvas/canvas-config-node-panel.tsx");
        const css = source("styles/globals.css");
        expect(promptPanel).toContain("videoSubmissionError");
        expect(promptPanel).toContain("visibleVideoSubmissionError");
        expect(promptPanel).toContain("videoModelFamilyOperations");
        expect(promptPanel).not.toContain("videoOperationRequirementHint");
        expect(promptPanel).not.toContain("需参考素材");
        expect(configPanel).not.toContain("videoOperationRequirementHint");
        expect(promptPanel).toContain("canvas-node-composer-actions");
        expect(promptPanel).not.toContain("disabled: Boolean(reason)");
        expect(configPanel).not.toContain("disabled: Boolean(reason)");
        expect(css).toContain(".canvas-node-composer-model");
        expect(css).toMatch(/\.canvas-node-composer-model\s*\{[\s\S]*?min-width:\s*220px/);
        expect(css).toMatch(/\.canvas-node-composer-mode-select\s*\{[\s\S]*?min-width:\s*104px/);
        expect(css).toMatch(/\.canvas-node-composer-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    });

    test("keeps image settings controls free of explanatory helper paragraphs", () => {
        expect(source("components/image-settings-panel.tsx")).not.toContain("按实际批次计费");
        expect(source("components/image-settings-panel.tsx")).not.toContain("悠船质量对应");
        expect(source("components/image-size-picker.tsx")).not.toContain("画面尺寸由比例和版本决定");
        expect(source("components/seedream-settings.tsx")).not.toContain("按实际出图收费");
    });

    test("does not show a one-option adaptive ratio selector", () => {
        const settings = source("components/video-settings-panel.tsx");
        expect(settings).toContain('videoRatioLabel(value)');
        expect(settings).toContain("profile.ratios.length > 1");
    });
});
