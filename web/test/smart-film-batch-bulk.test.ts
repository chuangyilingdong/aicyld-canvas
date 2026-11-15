import { describe, expect, test } from "bun:test";

import {
    applySmartFilmCreativeRequirement,
    batchBulkEligibility,
    shotConfirmationInput,
    smartFilmBulkTitle,
    smartFilmCreativeRequirementMarker,
} from "../src/pages/smart-film/batch-bulk-operations";
import type { ProjectShot, ShotRevision } from "../src/services/api/projects";
import type { SmartFilmProductionRun, SmartFilmScript } from "../src/services/api/smart-film-batches";

function script(id: string, projectId = "", status: SmartFilmScript["status"] = "draft") {
    return {
        id,
        title: id,
        content: "正文",
        status,
        projectId,
        unitId: projectId ? `unit-${id}` : undefined,
        revision: 1,
        createdAt: "2026-11-15T00:00:00Z",
        updatedAt: "2026-11-15T00:00:00Z",
    } as SmartFilmScript;
}

function run(scriptId: string, assetStatus: SmartFilmProductionRun["assetStatus"], storyboardStatus: SmartFilmProductionRun["storyboardStatus"]) {
    return { scriptId, assetStatus, storyboardStatus, status: "ready" } as SmartFilmProductionRun;
}

describe("smart film batch bulk operations", () => {
    test("builds numbered titles and supports an explicit ordinal placeholder", () => {
        expect(smartFilmBulkTitle("城市夜行", 0, 3, true)).toBe("城市夜行 01");
        expect(smartFilmBulkTitle("第 {n} 集", 2, 12, false)).toBe("第 03 集");
        expect(smartFilmBulkTitle("保持原名", 1, 3, false)).toBe("保持原名");
    });

    test("replaces the shared creative requirement instead of stacking copies", () => {
        const first = applySmartFilmCreativeRequirement("原剧本正文\n", "开头突出产品");
        const second = applySmartFilmCreativeRequirement(first, "结尾回到雨夜街景");

        expect(second.match(new RegExp(smartFilmCreativeRequirementMarker, "g"))).toHaveLength(1);
        expect(second).toContain("原剧本正文");
        expect(second).toContain("结尾回到雨夜街景");
        expect(second).not.toContain("开头突出产品");
    });

    test("separates draft actions from project confirmation actions", () => {
        const scripts = [
            script("draft"),
            script("assets", "project-assets", "assets_extracted"),
            script("storyboard", "project-storyboard", "storyboard_ready"),
        ];
        const runs = new Map<string, SmartFilmProductionRun>([
            ["assets", run("assets", "ready", "pending")],
            ["storyboard", run("storyboard", "confirmed", "ready")],
        ]);

        expect(batchBulkEligibility(scripts, runs)).toEqual({
            title: 3,
            creative: 3,
            regenerate: 1,
            delete: 1,
            confirmAssets: 1,
            confirmStoryboard: 1,
        });
    });

    test("confirmation input preserves prompt, beats, and shot asset roles", () => {
        const shot = {
            id: "shot-1",
            projectId: "project-1",
            unitId: "unit-1",
            currentRevisionId: "revision-1",
            title: "推门",
            description: "人物推开雨夜咖啡馆的门",
            position: 0,
            durationMs: 5000,
            status: "draft",
            createdAt: "2026-11-15T00:00:00Z",
            updatedAt: "2026-11-15T00:00:00Z",
        } as ProjectShot;
        const revision = {
            id: "revision-1",
            shotId: "shot-1",
            version: 1,
            plotDescription: "人物推门进入咖啡馆",
            action: "推门、抬头",
            dialogue: "我到了。",
            shotSize: "中景",
            cameraAngle: "平视",
            cameraMovement: "缓慢推进",
            durationMs: 4200,
            imagePrompt: "雨夜霓虹，中景",
            videoPrompt: "人物推门进入，镜头缓慢推进",
            negativePrompt: "变形",
            continuityNotes: "服装保持一致",
            actionBeatsJson: JSON.stringify([{ at: 0, action: "推门" }]),
            assetRolesJson: JSON.stringify([{ assetId: "asset-1", role: "character" }]),
            createdAt: "2026-11-15T00:00:00Z",
        } as ShotRevision;

        expect(shotConfirmationInput(shot, revision)).toMatchObject({
            plotDescription: "人物推门进入咖啡馆",
            durationMs: 4200,
            videoPrompt: "人物推门进入，镜头缓慢推进",
            actionBeats: [{ at: 0, action: "推门" }],
            assetRoles: [{ assetId: "asset-1", role: "character" }],
        });
    });
});
