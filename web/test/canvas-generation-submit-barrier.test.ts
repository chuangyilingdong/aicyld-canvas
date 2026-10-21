import { beforeEach, expect, test } from "bun:test";

import { runCanvasGenerationTaskToConsumer } from "@/lib/canvas/canvas-project-generation";
import { persistCanvasGenerationTarget } from "@/services/canvas-generation-target";
import { ApiError } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const targetNode: CanvasNodeData = {
    id: "generation-target",
    type: CanvasNodeType.Image,
    title: "生成目标",
    position: { x: 0, y: 0 },
    width: 320,
    height: 320,
    metadata: { prompt: "小猫", status: "loading" },
};

const project: CanvasProject = {
    id: "canvas-submit",
    title: "画布",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    revision: 1,
    nodes: [targetNode],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "grid",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    directorScenes: [],
};

const task: GenerationTask = {
    id: "task-submit",
    type: "canvas_image",
    status: "succeeded",
    prompt: "小猫",
    attempts: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
};

beforeEach(() => useCanvasStore.setState({ projects: [structuredClone(project)] }));

test("image, video, audio and text all save the target before submitting", async () => {
    for (const mode of ["image", "video", "audio", "text"] as const) {
        const events: string[] = [];
        const modeTask = mode === "text" ? { ...task, type: "canvas_text" } : task;
        await runCanvasGenerationTaskToConsumer(
            { projectId: project.id, nodeId: targetNode.id, mode, prompt: "小猫", config: {} as never, clientOperationId: `submit-${mode}` },
            {
                prepareTarget: async (options) => {
                    expect(options.nodeId).toBe(targetNode.id);
                    expect(options.nodes?.some((node) => node.id === targetNode.id)).toBe(true);
                    events.push("save");
                },
                targetSnapshot: () => ({ nodes: [targetNode] }),
                onSubmission: (metadata) => events.push(String(metadata.generationSubmissionState)),
                bindTask: () => events.push("bind"),
                runTask: async (options) => {
                    events.push("submit");
                    options.onTaskCreated?.(modeTask);
                    return mode === "text" ? ({ text: "完成" } as never) : ({ images: [] } as never);
                },
                consumeTask: async () => events.push("consume"),
            },
        );
        expect(events).toEqual(["submitting", "save", "submit", "accepted", "bind", "consume"]);
    }
});

test("a newly created target is persisted from the live editor snapshot when the store still has no node", async () => {
    useCanvasStore.setState({ projects: [{ ...structuredClone(project), nodes: [] }] });
    let savedNodes: CanvasNodeData[] = [];
    const events: string[] = [];
    await runCanvasGenerationTaskToConsumer(
        { projectId: project.id, nodeId: targetNode.id, mode: "video", prompt: "视频", config: {} as never, clientOperationId: "live-snapshot" },
        {
            targetSnapshot: () => ({ nodes: [targetNode] }),
            prepareTarget: (options) =>
                persistCanvasGenerationTarget(options, async (_projectId, patch) => {
                    savedNodes = patch.nodes || [];
                    events.push("saved");
                }),
            bindTask: () => undefined,
            runTask: async (options) => {
                expect(events).toEqual(["saved"]);
                options.onTaskCreated?.({ ...task, type: "canvas_video" });
                return { images: [] } as never;
            },
            consumeTask: async () => undefined,
        },
    );
    expect(savedNodes.map((node) => node.id)).toEqual([targetNode.id]);
    expect(useCanvasStore.getState().projects[0]?.nodes.map((node) => node.id)).toEqual([targetNode.id]);
});

test("an unknown submission stays unknown instead of being marked retry-safe", async () => {
    const states: string[] = [];
    await expect(
        runCanvasGenerationTaskToConsumer(
            { projectId: project.id, nodeId: targetNode.id, mode: "image", prompt: "小猫", config: {} as never, clientOperationId: "unknown-submit" },
            {
                prepareTarget: async () => undefined,
                targetSnapshot: () => ({ nodes: [targetNode] }),
                onSubmission: (metadata) => states.push(String(metadata.generationSubmissionState)),
                bindTask: () => undefined,
                consumeTask: async () => undefined,
                runTask: async () => {
                    throw new ApiError("图片结果尚未确认，请查询原任务", { reason: "image_submission_pending" });
                },
            },
        ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(states).toEqual(["submitting", "unknown"]);
});
