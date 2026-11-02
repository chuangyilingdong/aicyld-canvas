import { describe, expect, test } from "bun:test";

import { createShortDramaDemo, deriveShortDramaProgress } from "../src/lib/canvas/canvas-short-drama";
import { parseCanvasStarterPreset, resolveCanvasEmptyStateKind, starterModeForPreset } from "../src/lib/canvas/canvas-starter";

describe("canvas starter selection", () => {
    test("parses only supported presets", () => {
        expect(parseCanvasStarterPreset("guided")).toBe("guided");
        expect(parseCanvasStarterPreset("freeform")).toBe("freeform");
        expect(parseCanvasStarterPreset("sample")).toBe("sample");
        expect(parseCanvasStarterPreset("director")).toBeNull();
        expect(parseCanvasStarterPreset(null)).toBeNull();
    });

    test("sample starts as a guided canvas", () => {
        expect(starterModeForPreset("guided")).toBe("guided");
        expect(starterModeForPreset("sample")).toBe("guided");
        expect(starterModeForPreset("freeform")).toBe("freeform");
        expect(resolveCanvasEmptyStateKind({ nodeCount: 0, shortDramaEnabled: true, isProjectLinked: false, starterMode: starterModeForPreset("guided") })).toBe("guided");
    });
});

test("official demo project exposes the first three completed steps", () => {
    const demo = createShortDramaDemo({ x: 0, y: 0 });
    expect(demo.title).toBe("示例：小说改编漫剧");
    expect(demo.nodes).toHaveLength(3);
    expect(demo.connections).toHaveLength(2);
    const script = demo.nodes.find((node) => node.metadata?.workflowKind === "storyboard");
    expect(script?.metadata?.storyboard?.rows).toHaveLength(3);
    const progress = deriveShortDramaProgress(demo.nodes, demo.connections);
    expect(progress.active).toBe(true);
    expect(progress.completedCount).toBe(3);
    expect(progress.steps.find((step) => step.id === "video")?.status).toBe("current");
});