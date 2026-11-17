import { describe, expect, test } from "bun:test";

import { canvasFramePercentile } from "../src/pages/canvas/use-canvas-performance-telemetry";

describe("canvas performance telemetry", () => {
    test("reports a deterministic nearest-rank percentile", () => {
        expect(canvasFramePercentile([20, 12, 40, 16, 26], 0.5)).toBe(20);
        expect(canvasFramePercentile([20, 12, 40, 16, 26], 0.95)).toBe(40);
        expect(canvasFramePercentile([], 0.95)).toBe(0);
    });
});
