import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNodeOperationProgress } from "@/components/canvas/canvas-node-operation-progress";
import { canvasThemes } from "@/lib/canvas-theme";
import type { OperationProgress } from "@/lib/operation-progress";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function render(node: CanvasNodeData, operation: OperationProgress) {
    return renderToStaticMarkup(
        <CanvasNodeOperationProgress
            node={node}
            theme={canvasThemes.dark}
            operation={operation}
        />,
    );
}

test("生成前的素材上传在同一节点显示阶段、百分比和传输指标", () => {
    const operation: OperationProgress = {
        id: "upload",
        title: "准备生成素材",
        detail: "正在上传 参考图.png",
        phase: "transferring",
        loadedBytes: 512,
        totalBytes: 1024,
        bytesPerSecond: 256,
        startedAt: Date.now() - 1_000,
        updatedAt: Date.now(),
        target: { projectId: "canvas-a", nodeId: "video-1" },
    };
    const markup = render({ id: "video-1", type: CanvasNodeType.Video, title: "镜头", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: { status: "loading" } }, operation);
    expect(markup).toContain("准备生成素材");
    expect(markup).toContain("正在上传 参考图.png");
    expect(markup).toContain("50%");
    expect(markup).toContain("512 B / 1.0 KB");
    expect(markup).toContain("256 B/s");
    expect(markup).not.toContain("生成中");
});
