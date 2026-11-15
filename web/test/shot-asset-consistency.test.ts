import { describe, expect, test } from "bun:test";

import type { ProjectAsset, ProjectDetail, ProjectShot, ShotAssetReference, ShotRevision } from "../src/services/api/projects";
import { assetMentionIds, checkShotAssetConsistency } from "../src/pages/projects/detail/shot-asset-consistency";

function shot(id: string): ProjectShot {
    return { id, projectId: "project-1", currentRevisionId: `${id}-revision`, title: id, description: "", position: 0, durationMs: 3000, status: "draft", createdAt: "", updatedAt: "" };
}

function revision(shotId: string, imagePrompt: string): ShotRevision {
    return { id: `${shotId}-revision`, shotId, version: 1, plotDescription: "", action: "", dialogue: "", shotSize: "", cameraAngle: "", cameraMovement: "", durationMs: 3000, imagePrompt, videoPrompt: "", negativePrompt: "", continuityNotes: "", actionBeatsJson: "[]", createdAt: "" };
}

const imageAsset = {
    id: "image-1",
    title: "咖啡杯",
    mediaType: "image",
    storageKey: "resource:image-1",
    primaryVersionId: "image-1-v1",
    versionCount: 1,
    usages: [],
    category: "prop",
    status: "confirmed",
    position: 0,
    updatedAt: "",
} as ProjectAsset;

describe("shot asset consistency", () => {
    test("accepts a current visual asset and its bound token", () => {
        const currentShot = shot("shot-1");
        const reference = { id: "ref-1", shotId: currentShot.id, assetVersionId: "image-1-v1", role: "reference", status: "linked", asset: imageAsset } as ShotAssetReference;
        const detail = { assets: [imageAsset], shotRevisions: [revision(currentShot.id, "画面 @[asset:image-1]")], shotReferences: [reference] } as ProjectDetail;
        expect(checkShotAssetConsistency(detail, [currentShot])).toEqual([]);
    });

    test("reports text-only, stale, unbound-token and missing-asset issues", () => {
        const first = shot("shot-1");
        const second = shot("shot-2");
        const third = shot("shot-3");
        const textAsset = { ...imageAsset, id: "text-1", title: "文字场景", mediaType: "text", storageKey: undefined, primaryVersionId: "text-1-v1" } as ProjectAsset;
        const staleAsset = { ...imageAsset, id: "image-2", title: "旧产品图", primaryVersionId: "image-2-v2" } as ProjectAsset;
        const references = [
            { id: "ref-text", shotId: first.id, assetVersionId: "text-1-v1", role: "reference", status: "linked", asset: textAsset },
            { id: "ref-stale", shotId: second.id, assetVersionId: "image-2-v1", role: "reference", status: "linked", asset: staleAsset },
        ] as ShotAssetReference[];
        const detail = {
            assets: [textAsset, staleAsset],
            shotRevisions: [revision(first.id, "文字 @[asset:text-1]"), revision(second.id, "旧图 @[asset:image-2]"), revision(third.id, "缺失 @[asset:missing]")],
            shotReferences: references,
        } as ProjectDetail;
        const issues = checkShotAssetConsistency(detail, [first, second, third]);
        expect(issues.some((issue) => issue.code === "text_only_asset" && issue.shotId === first.id)).toBe(true);
        expect(issues.some((issue) => issue.code === "stale_asset_version" && issue.shotId === second.id)).toBe(true);
        expect(issues.some((issue) => issue.code === "unbound_token" && issue.shotId === third.id)).toBe(true);
        expect(issues.some((issue) => issue.code === "no_visual_assets" && issue.shotId === third.id && issue.severity === "warning")).toBe(true);
    });

    test("extracts asset mention ids", () => {
        expect(assetMentionIds("A @[asset:a] B @[asset:b]")).toEqual(["a", "b"]);
    });
});
