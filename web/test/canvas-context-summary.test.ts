import { describe, expect, test } from "bun:test";

import { summarizeCanvasContext } from "@/lib/canvas/canvas-context-summary";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(id: string, shotIndex?: number): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: shotIndex === undefined ? {} : { shotIndex },
    };
}

describe("canvas context summary", () => {
    test("shows the one-based storyboard shot number without incrementing it", () => {
        const shot = node("shot", 1);
        expect(summarizeCanvasContext([shot], new Set([shot.id])).shotLabel).toBe("镜头 1");
    });

    test("summarizes multiple selected shots without exposing one shot number", () => {
        const first = node("first", 1);
        const second = node("second", 2);
        expect(summarizeCanvasContext([first, second], new Set([first.id, second.id])).shotLabel).toBe("2 个镜头");
    });
});
