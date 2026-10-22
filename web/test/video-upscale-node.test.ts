import { describe, expect, test } from "bun:test";

import { getNodeAcceptedInputKinds, getNodeDefinition, getNodeMaxInputCount, getNodeResourceKind } from "../src/lib/canvas/node-registry";
import { getNodeSpec } from "../src/constant/canvas";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function node(metadata?: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "upscale", type: CanvasNodeType.Upscale, title: "视频超分", position: { x: 0, y: 0 }, width: 440, height: 420, metadata };
}

describe("视频超分节点", () => {
    test("只接受一个视频输入，完成后作为视频素材", () => {
        expect(getNodeDefinition(CanvasNodeType.Upscale)?.label).toBe("视频超分");
        expect(getNodeAcceptedInputKinds(CanvasNodeType.Upscale)).toEqual(["video"]);
        expect(getNodeMaxInputCount(CanvasNodeType.Upscale)).toBe(1);
        expect(getNodeResourceKind(node())).toBeNull();
        expect(getNodeResourceKind(node({ storageKey: "resource:upscaled", content: "https://cdn.example.com/upscaled.mp4" }))).toBe("video");
    });

    test("默认使用 1080p / Max，但不会自动提交任务", () => {
        expect(getNodeSpec(CanvasNodeType.Upscale).metadata).toEqual({
            status: "idle",
            videoUpscale: { resolution: "1080p", quality: "Max" },
        });
    });
});
