import { describe, expect, test } from "bun:test";

import { getNodeAcceptedInputKinds, getNodeDefinition, getNodeMaxInputCount, getNodeResourceKind } from "../src/lib/canvas/node-registry";
import { getNodeSpec } from "../src/constant/canvas";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function node(metadata?: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "upscale", type: CanvasNodeType.Upscale, title: "AI 超分", position: { x: 0, y: 0 }, width: 440, height: 420, metadata };
}

describe("媒体超分节点", () => {
    test("接受一个图片或视频输入，并按结果 MIME 暴露素材类型", () => {
        expect(getNodeDefinition(CanvasNodeType.Upscale)?.label).toBe("AI 超分");
        expect(getNodeAcceptedInputKinds(CanvasNodeType.Upscale)).toEqual(["image", "video"]);
        expect(getNodeMaxInputCount(CanvasNodeType.Upscale)).toBe(1);
        expect(getNodeResourceKind(node())).toBeNull();
        expect(getNodeResourceKind(node({ storageKey: "resource:upscaled", mimeType: "image/png" }))).toBe("image");
        expect(getNodeResourceKind(node({ storageKey: "resource:upscaled", mimeType: "video/mp4" }))).toBe("video");
    });

    test("默认 Topaz，但不会自动提交任务", () => {
        expect(getNodeSpec(CanvasNodeType.Upscale).metadata).toEqual({
            status: "idle",
            mediaUpscale: { model: "Topaz-Upscale-LowPirce", resolution: "1080p", quality: "Max" },
        });
    });
});
