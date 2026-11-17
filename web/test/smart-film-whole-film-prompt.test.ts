import { describe, expect, test } from "bun:test";

import { buildSmartFilmWholeFilmPrompt } from "@/pages/projects/detail/smart-film-whole-film-prompt";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";

describe("smart film whole-film prompt", () => {
    test("builds one compact prompt that references only the ordered storyboard images", () => {
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
        const detail = {
            assets: [],
            shotReferences: [],
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
                videoPrompt: "暗黑沧龙保持静止站立姿态。\n叙事意图：展示压迫感。\n表演调度：不要写进整片总提示词。",
                negativePrompt: "",
                continuityNotes: "",
                actionBeatsJson: "",
                createdAt: "2026-11-16T00:00:00Z",
            }],
        } as ProjectDetail;

        const plan = buildSmartFilmWholeFilmPrompt(detail, [{ shot, artifact }], 2);

        expect(plan.referenceImages.map((image) => image.storageKey)).toEqual(["resource:storyboard-resource"]);
        expect(plan.prompt).toContain("参考图片1至图片1");
        expect(plan.prompt).toContain("图片1（0–2 秒）：暗黑沧龙保持静止站立姿态");
        expect(plan.prompt).not.toContain("叙事意图");
        expect(plan.prompt).not.toContain("表演调度");
        expect(plan.prompt).not.toContain("@[asset:");
        expect(plan.prompt).not.toContain("skill-context");
    });

    test("keeps all eight image references in one bounded prompt", () => {
        const entries = Array.from({ length: 8 }, (_, index) => {
            const shot = {
                id: `shot-${index + 1}`,
                projectId: "project-1",
                title: `镜头${index + 1}`,
                description: "",
                position: index,
                durationMs: 1_875,
                status: "confirmed",
                currentRevisionId: `revision-${index + 1}`,
                createdAt: "2026-11-16T00:00:00Z",
                updatedAt: "2026-11-16T00:00:00Z",
            } satisfies ProjectShot;
            const artifact = {
                id: `storyboard-${index + 1}`,
                projectId: "project-1",
                shotId: shot.id,
                type: "storyboard",
                version: 1,
                resourceId: `storyboard-resource-${index + 1}`,
                status: "ready",
                selected: true,
                metadataJson: "",
                createdAt: "2026-11-16T00:00:00Z",
                updatedAt: "2026-11-16T00:00:00Z",
            } satisfies ShotArtifact;
            return { shot, artifact };
        });
        const detail = {
            assets: [],
            shotReferences: [],
            shotRevisions: entries.map(({ shot }, index) => ({
                id: shot.currentRevisionId,
                shotId: shot.id,
                version: 1,
                plotDescription: "",
                action: "",
                dialogue: index === 1 ? "第一关，救出小潜艇！" : "",
                shotSize: "",
                cameraAngle: "",
                cameraMovement: "",
                durationMs: shot.durationMs,
                imagePrompt: "",
                videoPrompt: `第${index + 1}镜动作持续推进，人物与场景保持连续。\n叙事意图：这段不应进入最终整片提示词。`,
                negativePrompt: "",
                continuityNotes: "",
                actionBeatsJson: "",
                createdAt: "2026-11-16T00:00:00Z",
            })),
        } as ProjectDetail;
        const plan = buildSmartFilmWholeFilmPrompt(detail, entries, 15, { maxChars: 1_200 });
        expect(plan.referenceImages).toHaveLength(8);
        expect(plan.prompt.length).toBeLessThanOrEqual(1_200);
        for (let index = 1; index <= 8; index += 1) expect(plan.prompt).toContain(`图片${index}（`);
        expect(plan.prompt).toContain("对白顺序：图片2「第一关，救出小潜艇！」");
        expect(plan.prompt).not.toContain("叙事意图");
        expect(plan.prompt).not.toContain("平台任务提示词已按模型上限压缩");
    });

    test("supports a dynamic reference count above eight", () => {
        const entries = Array.from({ length: 12 }, (_, index) => {
            const shot = {
                id: `dynamic-shot-${index + 1}`,
                projectId: "project-1",
                title: `动态镜头${index + 1}`,
                description: "",
                position: index,
                durationMs: 1_250,
                status: "confirmed",
                currentRevisionId: `dynamic-revision-${index + 1}`,
                createdAt: "2026-11-16T00:00:00Z",
                updatedAt: "2026-11-16T00:00:00Z",
            } satisfies ProjectShot;
            const artifact = {
                id: `dynamic-storyboard-${index + 1}`,
                projectId: "project-1",
                shotId: shot.id,
                type: "storyboard",
                version: 1,
                resourceId: `dynamic-resource-${index + 1}`,
                status: "ready",
                selected: true,
                metadataJson: "",
                createdAt: "2026-11-16T00:00:00Z",
                updatedAt: "2026-11-16T00:00:00Z",
            } satisfies ShotArtifact;
            return { shot, artifact };
        });
        const detail = {
            assets: [],
            shotReferences: [],
            shotRevisions: entries.map(({ shot }, index) => ({
                id: shot.currentRevisionId,
                shotId: shot.id,
                version: 1,
                plotDescription: "",
                action: "",
                dialogue: "",
                shotSize: "",
                cameraAngle: "",
                cameraMovement: "",
                durationMs: shot.durationMs,
                imagePrompt: "",
                videoPrompt: `动态镜头${index + 1}保持动作连续。`,
                negativePrompt: "",
                continuityNotes: "",
                actionBeatsJson: "",
                createdAt: "2026-11-16T00:00:00Z",
            })),
        } as ProjectDetail;
        const plan = buildSmartFilmWholeFilmPrompt(detail, entries, 15, { maxChars: 4_000 });
        expect(plan.referenceImages).toHaveLength(12);
        expect(plan.prompt.length).toBeLessThanOrEqual(4_000);
        for (let index = 1; index <= 12; index += 1) expect(plan.prompt).toContain(`图片${index}（`);
    });
});
