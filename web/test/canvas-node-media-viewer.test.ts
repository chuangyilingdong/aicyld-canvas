import { expect, test } from "bun:test";

import { canvasNodeMediaViewerFacts } from "@/components/canvas/canvas-node-media-viewer";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function mediaNode(overrides: Partial<CanvasNodeData["metadata"]> = {}): CanvasNodeData {
    return {
        id: "media",
        type: CanvasNodeType.Video,
        title: "验收视频",
        width: 320,
        height: 180,
        position: { x: 0, y: 0 },
        metadata: {
            prompt: "雨夜街头",
            model: "video-a",
            naturalWidth: 1280,
            naturalHeight: 720,
            size: "16:9",
            vquality: "1080p",
            durationMs: 12_000,
            bytes: 2048,
            mimeType: "video/mp4",
            ...overrides,
        },
    };
}

test("unified media facts describe image and video nodes consistently", () => {
    expect(canvasNodeMediaViewerFacts(mediaNode())).toEqual([
        { label: "类型", value: "视频" },
        { label: "像素尺寸", value: "1280 × 720 px" },
        { label: "比例", value: "16:9" },
        { label: "质量 / 分辨率", value: "1080p" },
        { label: "视频时长", value: "12秒" },
        { label: "文件大小", value: "2.0 KB" },
        { label: "格式", value: "video/mp4" },
    ]);
});

test("unified media facts omit unknown values instead of inventing metadata", () => {
    const node = mediaNode();
    node.type = CanvasNodeType.Image;
    node.metadata = { prompt: "图片", mimeType: "image/png" };
    expect(canvasNodeMediaViewerFacts(node)).toEqual([
        { label: "类型", value: "图片" },
        { label: "格式", value: "image/png" },
    ]);
});
