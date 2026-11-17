import { describe, expect, test } from "bun:test";

import { buildSmartFilmWholeFilmPrompt } from "@/pages/projects/detail/smart-film-whole-film-prompt";
import type { ProjectAsset, ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";

describe("smart film whole-film prompt", () => {
    test("includes storyboard and shot asset images with stable global indexes", () => {
        const shot = {
            id: "shot-1",
            projectId: "project-1",
            title: "暗黑沧龙登场",
            description: "",
            position: 0,
            durationMs: 2000,
            status: "confirmed",
            currentRevisionId: "revision-1",
            createdAt: "2026-11-16T00:00:00Z",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ProjectShot;
        const artifact = {
            id: "storyboard-1",
            projectId: "project-1",
            shotId: "shot-1",
            type: "storyboard",
            version: 1,
            resourceId: "storyboard-resource",
            status: "ready",
            selected: true,
            metadataJson: "",
            createdAt: "2026-11-16T00:00:00Z",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ShotArtifact;
        const scene = asset("asset-scene", "落灰展示柜与桌面", "environment", "scene-resource");
        const character = asset("asset-character", "暗黑沧龙", "character", "character-resource");
        const detail = {
            assets: [scene, character],
            shotReferences: [
                { id: "ref-scene", shotId: "shot-1", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-11-16T00:00:00Z" },
                { id: "ref-character", shotId: "shot-1", assetVersionId: "version-character", role: "reference", status: "linked", createdAt: "2026-11-16T00:00:00Z" },
            ],
            shotRevisions: [{
                id: "revision-1",
                shotId: "shot-1",
                version: 1,
                plotDescription: "",
                action: "缓慢抬头",
                dialogue: "",
                shotSize: "",
                cameraAngle: "",
                cameraMovement: "",
                durationMs: 2000,
                imagePrompt: "",
                videoPrompt: "暗黑沧龙保持静止站立姿态，背景是落灰展示柜与桌面 @[asset:missing]",
                negativePrompt: "",
                continuityNotes: "",
                actionBeatsJson: "",
                createdAt: "2026-11-16T00:00:00Z",
            }],
        } as ProjectDetail;

        const plan = buildSmartFilmWholeFilmPrompt(detail, [{ shot, artifact }], 2);

        expect(plan.referenceImages.map((image) => image.storageKey)).toEqual([
            "resource:storyboard-resource",
            "resource:scene-resource",
            "resource:character-resource",
        ]);
        expect(plan.prompt).toContain("使用第 1 张分镜图");
        expect(plan.prompt).toContain("暗黑沧龙 图片3保持静止站立姿态");
        expect(plan.prompt).toContain("落灰展示柜与桌面 图片2");
        expect(plan.prompt).not.toContain("@[asset:missing]");
    });
});

function asset(id: string, title: string, category: string, resourceId: string) {
    return {
        id,
        title,
        mediaType: "image",
        category,
        status: "confirmed",
        primaryVersionId: `version-${id.replace("asset-", "")}`,
        versionCount: 1,
        usages: [],
        position: 0,
        storageKey: `resource:${resourceId}`,
        updatedAt: "2026-11-16T00:00:00Z",
    } satisfies ProjectAsset;
}
