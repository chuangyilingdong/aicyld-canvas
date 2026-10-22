import { describe, expect, test } from "bun:test";

import {
    midjourneyActionCapabilities,
    midjourneyActionFromNode,
    midjourneyActionFromTask,
    midjourneyHdUpscaleCustomId,
    midjourneyHdUpscaleUnavailableReason,
    midjourneyIndexForNode,
    midjourneyImagineRequestOptions,
    midjourneyResultMode,
    midjourneyTaskButtons,
    midjourneyTaskMetadata,
    midjourneyUpstreamTaskId,
    midjourneyVideoIndexForNode,
} from "../src/lib/canvas/canvas-midjourney";
import { generationTaskMode } from "../src/lib/canvas/canvas-generation-task-sync";
import { explainGenerationError } from "../src/lib/generation-error";
import type { GenerationTask } from "../src/services/api/task-center";
import type { CanvasNodeData } from "../src/types/canvas";

function node(metadata: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id: "node-1", type: "image" as CanvasNodeData["type"], title: "image", position: { x: 0, y: 0 }, width: 512, height: 512, metadata };
}

function task(action: string, extra: Record<string, unknown> = {}): GenerationTask {
    return {
        id: "local-task-id",
        type: "canvas_image",
        status: "succeeded",
        prompt: "",
        attempts: 1,
        createdAt: "2026-10-22T00:00:00Z",
        updatedAt: "2026-10-22T00:00:00Z",
        inputJson: JSON.stringify({ mode: "image", metadata: { midjourney: { action, ...extra } } }),
    };
}

describe("Midjourney canvas contract", () => {
    test("maps Imagine quality and version without turning quality into a speed tier", () => {
        expect(midjourneyImagineRequestOptions({ quality: "1", version: "v8.1", repeat: 8, tile: false })).toEqual({
            action: "imagine",
            quality: "1",
            version: "8.1",
            tile: false,
        });
    });

    test("uses only providerRequestId as the upstream parent", () => {
        expect(midjourneyUpstreamTaskId(node({ taskId: "local-task-id", taskProviderRequestId: "upstream-task-id" }))).toBe("upstream-task-id");
        expect(midjourneyUpstreamTaskId(node({ taskId: "local-task-id" }))).toBe("");
    });

    test("derives the one-based Midjourney index from the output position", () => {
        expect(midjourneyIndexForNode(node({ taskOutputIndex: 0 }))).toBe(1);
        expect(midjourneyIndexForNode(node({ taskOutputIndex: 2 }))).toBe(3);
        expect(midjourneyIndexForNode(node({ taskOutputIndex: 9 }))).toBe(4);
        expect(midjourneyVideoIndexForNode(node({ taskOutputIndex: 0 }))).toBe(0);
        expect(midjourneyVideoIndexForNode(node({ taskOutputIndex: 2 }))).toBe(2);
        expect(midjourneyVideoIndexForNode(node({ taskOutputIndex: 9 }))).toBe(3);
    });
    test("keeps inpaint as a two-stage flow", () => {
        const capabilities = midjourneyActionCapabilities(node({ midjourneyAction: "inpaint", taskProviderRequestId: "upstream-inpaint" }));
        expect(capabilities.map((item) => item.action)).toEqual(["modal"]);
        expect(capabilities[0]).toMatchObject({ enabled: true, needsMask: true, needsPrompt: true });
        expect(midjourneyActionCapabilities(node({ midjourneyAction: "inpaint" }))[0]).toMatchObject({ enabled: false });
    });

    test("enables grid actions by parent type and disables video for v5", () => {
        const grid = midjourneyActionCapabilities(node({ midjourneyAction: "imagine", taskProviderRequestId: "upstream-grid" }));
        expect(grid.find((item) => item.action === "upscale")?.enabled).toBe(true);
        expect(grid.find((item) => item.action === "variation")?.enabled).toBe(true);
        expect(grid.find((item) => item.action === "modal")).toBeUndefined();

        const legacy = midjourneyActionCapabilities(node({ midjourneyAction: "imagine", midjourneyVersion: "v5.2", taskProviderRequestId: "upstream-grid" }));
        expect(legacy.find((item) => item.action === "video")).toMatchObject({ enabled: false });
    });

    test("recognizes ordinary imagine tasks from the Midjourney interface", () => {
        const imagine = {
            ...task("imagine"),
            inputJson: JSON.stringify({ mode: "image", config: { interfaceType: "midjourney" } }),
            model: "midjourney-imagine",
        };
        expect(midjourneyActionFromTask(imagine)).toBe("imagine");
        expect(midjourneyTaskMetadata(imagine)).toMatchObject({ midjourneyAction: "imagine" });
    });
    test("gates parent actions by the upstream action and version", () => {
        const grid = midjourneyActionCapabilities(node({ midjourneyAction: "imagine", taskProviderRequestId: "upstream-grid" }));
        expect(grid.find((item) => item.action === "inpaint")).toBeUndefined();
        expect(grid.find((item) => item.action === "zoom")).toBeUndefined();
        expect(grid.find((item) => item.action === "variation")?.enabled).toBe(true);

        const upscale = midjourneyActionCapabilities(node({ midjourneyAction: "upscale", taskProviderRequestId: "upstream-single" }));
        expect(upscale.find((item) => item.action === "inpaint")?.enabled).toBe(true);
        expect(upscale.find((item) => item.action === "zoom")?.enabled).toBe(true);
        expect(upscale.find((item) => item.action === "pan")?.enabled).toBe(false);
        expect(upscale.find((item) => item.action === "high-variation")?.enabled).toBe(true);

        const v8 = midjourneyActionCapabilities(node({ midjourneyAction: "imagine", midjourneyVersion: "8.1", taskProviderRequestId: "upstream-v8" }));
        expect(v8.find((item) => item.action === "upscale")?.enabled).toBe(false);
        expect(v8.find((item) => item.action === "remix-strong")?.enabled).toBe(true);
    });
    test("stops offering MODAL after the inpaint task has been continued", () => {
        const pending = node({ taskId: "local-inpaint", midjourneyAction: "inpaint", taskProviderRequestId: "upstream-inpaint" });
        expect(midjourneyActionFromNode(pending)).toBe("inpaint");
        expect(midjourneyActionCapabilities(pending).map((item) => item.action)).toEqual(["modal"]);

        const submitted = node({
            taskId: "local-inpaint",
            midjourneyAction: "inpaint",
            midjourneyModalSubmittedTaskId: "local-inpaint",
            taskProviderRequestId: "upstream-inpaint",
        });
        expect(midjourneyActionFromNode(submitted)).toBe("modal");
        expect(midjourneyActionCapabilities(submitted).some((item) => item.action === "modal")).toBe(false);
    });
    test("routes describe and video results to their real node types", () => {
        expect(midjourneyResultMode("describe")).toBe("text");
        expect(midjourneyResultMode("video")).toBe("video");
        expect(midjourneyResultMode("upscale")).toBe("image");
        expect(generationTaskMode(task("describe"))).toBe("text");
        expect(generationTaskMode(task("video"))).toBe("video");
    });

    test("explains Midjourney parent and mask constraints without a generic parameter message", () => {
        const parent = explainGenerationError({ code: "invalid_params", message: "Midjourney modal 缺少 inpaint task_id" });
        expect(parent.category).toBe("invalid_params");
        expect(parent.reason).toContain("缺少 inpaint task_id");
        expect(parent.action).toContain("不要把本地任务 ID");
        const mask = explainGenerationError({ code: "invalid_params", message: "Midjourney modal 缺少 mask_url" });
        expect(mask.action).toContain("补蒙版");
    });
    test("persists action lineage from task metadata", () => {
        const describeTask = task("describe", { version: "v7" });
        expect(midjourneyActionFromTask(describeTask)).toBe("describe");
        expect(midjourneyTaskMetadata(describeTask)).toMatchObject({ midjourneyAction: "describe", midjourneyVersion: "v7" });
        expect(midjourneyTaskMetadata(task("inpaint", { taskId: "upstream-parent" }))).toMatchObject({
            midjourneyAction: "inpaint",
            midjourneyParentTaskId: "upstream-parent",
            midjourneyStage: "inpaint",
            midjourneyNextAction: "modal",
        });
    });

    test("keeps Midjourney button snapshots and derives documented HD upscale commands", () => {
        const completed: GenerationTask = {
            ...task("imagine", { version: "8.1" }),
            resultJson: JSON.stringify({
                mode: "image",
                images: [{ dataUrl: "data:image/png;base64,large-image-payload" }],
                providerMetadata: { midjourneyButtons: [{ customId: "MJ::JOB::upsample::2::token-2", label: "U2" }] },
            }),
        };
        expect(midjourneyTaskButtons(completed)).toEqual([{ customId: "MJ::JOB::upsample::2::token-2", label: "U2", emoji: undefined }]);
        const parent = { ...node({ midjourneyAction: "imagine", midjourneyVersion: "8.1", taskProviderRequestId: "upstream-grid", midjourneyButtons: midjourneyTaskButtons(completed) }) };
        expect(midjourneyHdUpscaleCustomId(parent, 2, "hd-subtle", "8.1")).toBe("MJ::JOB::upsample_v7_2x_subtle::2::token-2");
        expect(midjourneyHdUpscaleCustomId(parent, 2, "hd-creative", "8.1")).toBe("MJ::JOB::upsample_v7_2x_creative::2::token-2");
        expect(midjourneyHdUpscaleUnavailableReason(parent, 2, "8.1")).toBe("");
        expect(midjourneyHdUpscaleCustomId(parent, 2, "hd-subtle", "8.2")).toBe("");
        expect(midjourneyHdUpscaleUnavailableReason(parent, 2, "8.2")).toContain("v8.2");
    });
});
