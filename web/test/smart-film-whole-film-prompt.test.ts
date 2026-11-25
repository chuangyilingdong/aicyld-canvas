import { describe, expect, test } from "bun:test";

import { buildSmartFilmWholeFilmPrompt } from "@/pages/projects/detail/smart-film-whole-film-prompt";
import type { ProjectAsset, ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import type { SmartFilmSkillSnapshot } from "@/services/api/smart-film-batches";

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
        expect(plan.prompt).toContain("参考图编号与镜头编号是两套编号");
        expect(plan.prompt).toContain("参考图1对应镜头1");
        expect(plan.prompt).toContain("镜头1（0–2 秒）：暗黑沧龙保持静止站立姿态");
        expect(plan.prompt).not.toContain("叙事意图");
        expect(plan.prompt).not.toContain("表演调度");
        expect(plan.prompt).not.toContain("@[asset:");
        expect(plan.prompt).not.toContain("skill-context");
    });

    test("passes linked product multi-view assets and the loaded video skill into generation", () => {
        const shot = {
            id: "shot-product",
            projectId: "project-1",
            title: "产品展示",
            description: "",
            position: 0,
            durationMs: 5_000,
            status: "confirmed",
            currentRevisionId: "revision-product",
            createdAt: "2026-11-16T00:00:00Z",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ProjectShot;
        const nextShot = {
            ...shot,
            id: "shot-product-next",
            title: "产品防御",
            position: 1,
            durationMs: 5_000,
            currentRevisionId: "revision-product-next",
        } satisfies ProjectShot;
        const product = {
            id: "product-turnaround",
            title: "生成图片",
            mediaType: "image",
            category: "prop",
            status: "ready",
            primaryVersionId: "product-version-1",
            versionCount: 1,
            usages: [],
            position: 0,
            storageKey: "resource:product-turnaround-resource",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ProjectAsset;
        const artifact = {
            id: "storyboard-product",
            projectId: "project-1",
            shotId: shot.id,
            type: "storyboard",
            version: 1,
            resourceId: "storyboard-product-resource",
            status: "ready",
            selected: true,
            metadataJson: "",
            createdAt: "2026-11-16T00:00:00Z",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ShotArtifact;
        const nextArtifact = {
            ...artifact,
            id: "storyboard-product-next",
            shotId: nextShot.id,
            resourceId: "storyboard-product-next-resource",
        } satisfies ShotArtifact;
        const detail = {
            assets: [product],
            shotReferences: [shot, nextShot].map((item) => ({
                id: `product-reference-${item.id}`,
                shotId: item.id,
                assetVersionId: "product-version-1",
                role: "reference",
                status: "linked",
                createdAt: "2026-11-16T00:00:00Z",
            })),
            shotRevisions: [shot, nextShot].map((item) => ({
                id: item.currentRevisionId!,
                shotId: item.id,
                version: 1,
                plotDescription: "",
                action: "产品保持稳定",
                dialogue: "",
                shotSize: "",
                cameraAngle: "",
                cameraMovement: "",
                durationMs: item.durationMs,
                imagePrompt: "",
                videoPrompt: "图片1=生成图片中的产品保持稳定。@[asset:product-turnaround]",
                negativePrompt: "",
                continuityNotes: "",
                actionBeatsJson: "",
                assetRolesJson: JSON.stringify([{ assetId: product.id, versionId: "product-version-1", title: product.title, role: "prop" }]),
                createdAt: "2026-11-16T00:00:00Z",
            })),
        } as ProjectDetail;
        const skillSnapshot = {
            skillId: "short-film-skill",
            versionId: "short-film-skill-v1",
            contentHash: "abc123",
            name: "产品短片导演",
            stages: { video: "三视图的每个角度都是同一产品的外观设定，不得复制成多个产品。" },
        } satisfies SmartFilmSkillSnapshot;

        const plan = buildSmartFilmWholeFilmPrompt(detail, [{ shot, artifact }, { shot: nextShot, artifact: nextArtifact }], 10, { skillSnapshot });

        expect(plan.referenceImages.map((image) => image.storageKey)).toEqual([
            "resource:product-turnaround-resource",
            "resource:storyboard-product-resource",
            "resource:storyboard-product-next-resource",
        ]);
        expect(plan.prompt).toContain("【技能规范】");
        expect(plan.prompt).toContain("三视图的每个角度都是同一产品");
        expect(plan.prompt).toContain("所有视角都是同一角色或产品的不同视图");
        expect(plan.prompt).toContain("参考图1：项目绑定的产品/道具外观设定");
        expect(plan.prompt).toContain("参考图2对应镜头1");
        expect(plan.prompt).toContain("参考图3对应镜头2");
        expect(plan.prompt).toContain("镜头1（0–5 秒）：产品/道具“生成图片”外观以参考图1为准");
        expect(plan.prompt).toContain("镜头2（5–10 秒）：产品/道具“生成图片”外观以参考图1为准");
        expect(plan.prompt).toContain("外观以参考图1为准");
        expect(plan.taskPrompt).toContain("产品/道具“生成图片”外观以参考图1为准");
        expect(plan.taskPrompt).not.toContain("【技能规范】");
        expect(plan.prompt).not.toContain("图片1=生成图片中的产品");
        expect(plan.prompt).not.toContain("@[asset:");
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
        for (let index = 1; index <= 8; index += 1) expect(plan.prompt).toContain(`镜头${index}（`);
        expect(plan.prompt).toContain("对白顺序：镜头2「第一关，救出小潜艇！」");
        expect(plan.prompt).not.toContain("叙事意图");
        expect(plan.prompt).not.toContain("平台任务提示词已按模型上限压缩");
    });

    test("includes unbound product and character inputs without requiring storyboard images", () => {
        const shot = { id: "s1", title: "展示", durationMs: 5000, description: "展示产品", currentRevisionId: "r1" } as ProjectShot;
        const product = { id: "product", title: "产品", mediaType: "image", category: "prop", storageKey: "resource:product-image" } as ProjectAsset;
        const character = { id: "person", title: "人物", mediaType: "image", category: "character", storageKey: "resource:person-image" } as ProjectAsset;
        const detail = { assets: [product, character], shotReferences: [], shotRevisions: [] } as unknown as ProjectDetail;
        const options = { inputAssetRoles: { product: "product", person: "character" }, inputAssetNames: { product: "机甲鲨", person: "少女" } };
        const plan = buildSmartFilmWholeFilmPrompt(detail, [{ shot }], 5, options);
        expect(plan.referenceImages.map((image) => image.storageKey)).toEqual(["resource:product-image", "resource:person-image"]);
        expect(plan.prompt).toContain("参考图1：项目绑定的产品/道具外观设定（机甲鲨）");
        expect(plan.prompt).toContain("参考图2：项目绑定的人物身份与造型外观设定（少女）");
        expect(plan.taskPrompt).toContain("产品/道具“机甲鲨”外观以参考图1为准");
        expect(plan.taskPrompt).toContain("人物“少女”外观以参考图2为准");
        expect(plan.prompt).toContain("产品必须在符合剧情的镜头中清晰可见");
        expect(plan.missingInputAssets).toEqual([]);
        const missing = buildSmartFilmWholeFilmPrompt({ ...detail, assets: [character] }, [{ shot }], 5, options);
        expect(missing.missingInputAssets).toEqual(["机甲鲨"]);
    });

    test("numbers partial storyboards after input assets and maps them to their original shots", () => {
        const first = { id: "s1", title: "一", durationMs: 5000 } as ProjectShot;
        const second = { id: "s2", title: "二", durationMs: 5000 } as ProjectShot;
        const asset = { id: "product", title: "产品", mediaType: "image", category: "prop", storageKey: "resource:product-image" } as ProjectAsset;
        const detail = { assets: [asset], shotReferences: [], shotRevisions: [] } as unknown as ProjectDetail;
        const artifact = { resourceId: "storyboard-2", status: "ready" } as ShotArtifact;
        const plan = buildSmartFilmWholeFilmPrompt(detail, [{ shot: first }, { shot: second, artifact }], 10, { inputAssetRoles: { product: "product" } });
        expect(plan.referenceImages.map((image) => image.storageKey)).toEqual(["resource:product-image", "resource:storyboard-2"]);
        expect(plan.prompt).toContain("参考图2对应镜头2");
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
        for (let index = 1; index <= 12; index += 1) expect(plan.prompt).toContain(`镜头${index}（`);
    });
});
