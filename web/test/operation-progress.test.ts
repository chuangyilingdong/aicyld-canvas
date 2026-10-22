import { expect, test } from "bun:test";

import { canvasNodeOperation, operationProgressView, type OperationProgress } from "../src/lib/operation-progress";

const base: OperationProgress = {
    id: "upload",
    title: "准备生成素材",
    detail: "正在上传参考图",
    phase: "transferring",
    loadedBytes: 512,
    totalBytes: 1024,
    bytesPerSecond: 256,
    startedAt: 1_000,
    updatedAt: 2_000,
    target: { projectId: "canvas-a", nodeId: "video", taskId: "old-task" },
};

test("节点操作必须同时匹配画布、节点和当前任务，旧任务不能覆盖新任务", () => {
    const entries = { upload: base };
    expect(canvasNodeOperation(entries, "canvas-a", "video", "old-task")).toBe(base);
    expect(canvasNodeOperation(entries, "canvas-b", "video", "old-task")).toBeUndefined();
    expect(canvasNodeOperation(entries, undefined, "video", "old-task")).toBeUndefined();
    expect(canvasNodeOperation(entries, "canvas-a", "video", "new-task")).toBeUndefined();
    expect(canvasNodeOperation(entries, "canvas-a", "other-video", "old-task")).toBeUndefined();
    expect(canvasNodeOperation({ upload: { ...base, phase: "done" } }, "canvas-a", "video", "old-task")).toBeUndefined();
});

test("上传阶段展示字节、速度和百分比，任务创建前也能绑定目标节点", () => {
    const preparing = { ...base, phase: "preparing" as const, target: { projectId: "canvas-a", nodeId: "video" } };
    expect(canvasNodeOperation({ preparing }, "canvas-a", "video", "new-task")).toBe(preparing);
    expect(operationProgressView(base, 4_000)).toMatchObject({ percent: 50, size: "512 B / 1.0 KB", speed: "256 B/s", timing: "已用 3 秒" });
});
