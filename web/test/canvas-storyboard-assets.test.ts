import { describe, expect, it } from "bun:test";

import {
    applyAssetsToStoryboardRows,
    buildStoryboardAssetCatalog,
    collectSelectedBindableAssetNodes,
    mergeStoryboardAssetBindings,
    storyboardAssetNodeBadge,
    storyboardAssetRoleForNode,
} from "@/lib/canvas/canvas-storyboard-assets";
import { reconcileStoryboardTargetConnections, storyboardComposerContent, storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";

const node = (id: string, type: CanvasNodeType, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata,
});

const row: StoryboardRow = {
    id: "row-1",
    shotNumber: 1,
    durationSeconds: 6,
    plotDescription: "雨夜追逐",
    dialogue: "快走",
    characters: [{ characterName: "林岚", characterAssetId: "character-asset" }],
    narrativeIntent: "",
    viewerPOV: "",
    performanceBlocking: "",
    shotSize: "",
    emotion: "",
    lightingAndAtmosphere: "",
    audioEffects: "",
    camera: "",
    motion: "",
    timeBeats: "",
    imageGenerationPrompt: "",
    videoMotionPrompt: "快速跟拍",
    mustHave: [],
    optionalDetails: [],
    continuityOut: "",
    negativePrompt: "",
    assetBindings: [{ nodeId: "prop", role: "prop", priority: 80 }],
    imageNodeId: "first-frame",
    status: "idle",
};

describe("storyboard asset catalog", () => {
    it("sends reusable image, video, audio and character assets but excludes generated shots", () => {
        const assets = buildStoryboardAssetCatalog([
            node("image", CanvasNodeType.Image, { content: "data:image/png;base64,x", assetCategory: "environment" }),
            node("video", CanvasNodeType.Video, { storageKey: "resource:video" }),
            node("audio", CanvasNodeType.Audio, { content: "data:audio/wav;base64,x" }),
            node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "character-asset", characterVersionId: "v1" }),
            node("shot", CanvasNodeType.Image, { content: "data:image/png;base64,x", workflowKind: "shot" }),
            node("text", CanvasNodeType.Text, { content: "story" }),
        ]);

        expect(assets.map((asset) => [asset.id, asset.type])).toEqual([
            ["image", "image"],
            ["video", "video"],
            ["audio", "audio"],
            ["character", "character"],
        ]);
    });

    it("normalizes selectable canvas assets and supports multi-row binding without duplicates", () => {
        const character = node("character", CanvasNodeType.Text, { workflowKind: "character", characterAssetId: "character-asset" });
        const scene = node("scene", CanvasNodeType.Image, { content: "data:image/png;base64,x", assetCategory: "environment" });
        const audio = node("audio", CanvasNodeType.Audio, { content: "data:audio/wav;base64,x" });
        const selected = collectSelectedBindableAssetNodes([character, scene, audio], new Set(["character", "audio"]));
        expect(selected.map((asset) => asset.id)).toEqual(["character", "audio"]);
        expect(selected.map(storyboardAssetRoleForNode)).toEqual(["character", "audio"]);
        expect(selected.map(storyboardAssetNodeBadge)).toEqual(["角色", "音频"]);

        const merged = mergeStoryboardAssetBindings([{ nodeId: "scene", role: "prop", priority: 80 }], selected);
        expect(merged).toEqual([
            { nodeId: "scene", role: "prop", priority: 80 },
            { nodeId: "character", role: "character", priority: 100 },
            { nodeId: "audio", role: "audio", priority: 70 },
        ]);

        const applied = applyAssetsToStoryboardRows([row, { ...row, id: "row-2", shotNumber: 2, assetBindings: [] }], ["row-1", "row-2"], [character, audio]);
        expect(applied.updatedShotNumbers).toEqual([1, 2]);
        expect(applied.rows[0].assetBindings.map((item) => item.nodeId)).toEqual(["prop", "character", "audio"]);
        expect(applied.rows[1].assetBindings.map((item) => item.nodeId)).toEqual(["character", "audio"]);
    });
});

describe("storyboard target materializer", () => {
    const script = node("script", CanvasNodeType.Script, { storyboard: { rows: [row], visibleColumns: [], referenceNodeIds: ["project-style"] } });
    const nodes = [script, node("project-style", CanvasNodeType.Image, { content: "style" }), node("prop", CanvasNodeType.Image, { content: "prop" }), node("character", CanvasNodeType.Image, { workflowKind: "character", characterAssetId: "character-asset" }), node("manual", CanvasNodeType.Video, { content: "video" }), node("direct-manual", CanvasNodeType.Audio, { content: "audio" }), node("first-frame", CanvasNodeType.Image, { content: "frame", workflowKind: "shot" }), node("target", CanvasNodeType.Video)];
    const connections: CanvasConnection[] = [{ id: "manual-row-input", fromNodeId: "manual", toNodeId: "script", toHandleId: "row:row-1" }];

    it("combines stable bindings and preserves identity mentions across node order", () => {
        const references = storyboardRowReferenceNodeIds(script, row, nodes, connections, true);
        expect(references).toEqual(["project-style", "prop", "character", "manual", "first-frame"]);
        const content = storyboardComposerContent("快速跟拍", references, nodes);
        expect(content).toBe("参考资产：@[node:project-style] @[node:prop] @[node:character] @[node:manual] @[node:first-frame]\n快速跟拍");
        expect(storyboardComposerContent("快速跟拍", references, [...nodes].reverse())).toBe(content);

        const withDirectManualInput = storyboardRowReferenceNodeIds(script, row, nodes, [...connections, { id: "direct", fromNodeId: "direct-manual", toNodeId: "target" }], false, "target");
        expect(withDirectManualInput).toContain("direct-manual");
    });

    it("reconciles managed edges without deleting manual connections", () => {
        const manualTargetEdge: CanvasConnection = { id: "manual-target", fromNodeId: "manual", toNodeId: "target" };
        const created = reconcileStoryboardTargetConnections([manualTargetEdge], script, row, "target", ["prop", "character"]);
        expect(created.filter((edge) => edge.relation === "storyboard-output")).toHaveLength(1);
        expect(created.filter((edge) => edge.relation === "storyboard-asset-reference").map((edge) => edge.fromNodeId).sort()).toEqual(["character", "prop"]);

        const reconciled = reconcileStoryboardTargetConnections(created, script, row, "target", ["character"]);
        expect(reconciled.some((edge) => edge.id === "manual-target")).toBe(true);
        expect(reconciled.some((edge) => edge.relation === "storyboard-asset-reference" && edge.fromNodeId === "prop")).toBe(false);
    });
});
