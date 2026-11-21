import { expect, test } from "bun:test";

import { canvasNodeGenerationInfoRows } from "@/components/canvas/canvas-node-info-modal";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

test("node information keeps generation parameters and timing in the extracted modal contract", () => {
    const node: CanvasNodeData = {
        id: "video-node",
        type: CanvasNodeType.Video,
        title: "镜头",
        width: 320,
        height: 180,
        position: { x: 0, y: 0 },
        metadata: {
            model: "video-a",
            size: "16:9",
            vquality: "1080p",
            seconds: "5",
            generateAudio: "true",
            watermark: "false",
            references: ["assets/a.png", "assets/b.png"],
            taskCreatedAt: "2026-11-21T01:00:00.000Z",
            taskStartedAt: "2026-11-21T01:00:01.000Z",
            taskCompletedAt: "2026-11-21T01:00:04.000Z",
            taskDurationMs: 3000,
        },
    };

    const rows = canvasNodeGenerationInfoRows(node);
    expect(rows).toContainEqual({ label: "模型", value: "video-a" });
    expect(rows).toContainEqual({ label: "生成尺寸", value: "16:9" });
    expect(rows).toContainEqual({ label: "生成声音", value: "开启" });
    expect(rows).toContainEqual({ label: "引用素材", value: "2 个（a.png、b.png）" });
    expect(rows).toContainEqual({ label: "耗时", value: "3秒" });
});

test("node information omits unavailable fields instead of inventing defaults", () => {
    const node: CanvasNodeData = {
        id: "image-node",
        type: CanvasNodeType.Image,
        title: "图片",
        width: 100,
        height: 100,
        position: { x: 0, y: 0 },
        metadata: { model: "image-a" },
    };
    expect(canvasNodeGenerationInfoRows(node)).toEqual([{ label: "模型", value: "image-a" }]);
});
