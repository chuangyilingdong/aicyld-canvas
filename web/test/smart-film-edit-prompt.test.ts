import { describe, expect, test } from "bun:test";

import { buildSmartFilmEditPrompt } from "@/pages/projects/detail/smart-film-edit-prompt";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";

describe("smart film edit prompt", () => {
    test("builds a copyable post-production prompt from the generated film and shot plan", () => {
        const shots = [
            shot("shot-1", "开场", 3_000, "第一关，救出小潜艇！"),
            shot("shot-2", "收尾", 2_000, ""),
        ];
        const entries = shots.map((item, index) => ({
            shot: item,
            artifact: artifact(item.id, index),
        }));
        const detail = {
            project: { name: "海底救援", aspectRatio: "9:16" },
            assets: [],
            shotReferences: [],
            shotRevisions: shots.map((item, index) => ({
                id: item.currentRevisionId,
                shotId: item.id,
                version: 1,
                plotDescription: "",
                action: "",
                dialogue: index === 0 ? item.description : "",
                shotSize: "",
                cameraAngle: "",
                cameraMovement: "",
                durationMs: item.durationMs,
                imagePrompt: "",
                videoPrompt: index === 0 ? "潜航器靠近破口，小潜艇正在敲击舱壁。" : "机甲把电池稳稳送到基站，计时器停在成绩画面。",
                negativePrompt: "",
                continuityNotes: "",
                actionBeatsJson: "",
                createdAt: "2026-11-17T00:00:00Z",
            })),
        } as ProjectDetail;

        const prompt = buildSmartFilmEditPrompt({
            detail,
            shots,
            entries,
            targetSeconds: 5,
            videoResourceId: "film-resource",
            taskId: "film-task-1234",
            skillName: "短剧全链路 Skill 套件",
        });

        expect(prompt).toContain("# 海底救援 · 整片剪辑提示词");
        expect(prompt).toContain("目标成片时长：5 秒");
        expect(prompt).toContain("剪辑规范：短剧全链路 Skill 套件");
        expect(prompt).toContain("0–3 秒");
        expect(prompt).toContain("3–5 秒");
        expect(prompt).toContain("第一关，救出小潜艇！");
        expect(prompt).toContain("源入出点、实测时长");
        expect(prompt).toContain("严格按本提示词和实际素材组装时间线");
        expect(prompt).toContain("film-resource");
    });
});

function shot(id: string, title: string, durationMs: number, description: string) {
    return {
        id,
        projectId: "project-1",
        title,
        description,
        position: Number(id.endsWith("2")),
        durationMs,
        status: "confirmed",
        currentRevisionId: `revision-${id}`,
        createdAt: "2026-11-17T00:00:00Z",
        updatedAt: "2026-11-17T00:00:00Z",
    } satisfies ProjectShot;
}

function artifact(shotId: string, index: number) {
    return {
        id: `artifact-${index + 1}`,
        projectId: "project-1",
        shotId,
        type: "storyboard",
        version: 1,
        resourceId: `resource-${index + 1}`,
        status: "ready",
        selected: true,
        metadataJson: "",
        createdAt: "2026-11-17T00:00:00Z",
        updatedAt: "2026-11-17T00:00:00Z",
    } satisfies ShotArtifact;
}
