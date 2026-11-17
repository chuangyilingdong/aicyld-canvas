import { expect, test } from "bun:test";

import { projectSummaryStage } from "@/lib/project-workbench";
import type { ProjectSummary } from "@/services/api/projects";

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
    return {
        project: {
            id: "project-1",
            userId: "user-1",
            name: "测试项目",
            type: "smart-film",
            aspectRatio: "9:16",
            sourceType: "text",
            description: "",
            stylePresetId: "",
            status: "active",
            revision: 1,
            createdAt: "2026-11-17T00:00:00Z",
            updatedAt: "2026-11-17T00:00:00Z",
        },
        canvasCount: 0,
        assetCount: 0,
        unitCount: 0,
        completedUnitCount: 0,
        activeTaskCount: 0,
        ...overrides,
    };
}

test("只有存在活动生成任务时才显示生成中", () => {
    expect(projectSummaryStage(summary({ activeTaskCount: 2 }))).toMatchObject({ label: "生成中", tone: "generating" });
});

test("尚未开始的项目显示草稿", () => {
    expect(projectSummaryStage(summary())).toMatchObject({ label: "草稿", tone: "draft" });
});

test("已有章节或资产但未在生成的项目显示制作中", () => {
    expect(projectSummaryStage(summary({ unitCount: 1 }))).toMatchObject({ label: "制作中", tone: "in-progress" });
    expect(projectSummaryStage(summary({ assetCount: 3 }))).toMatchObject({ label: "制作中", tone: "in-progress" });
    expect(projectSummaryStage(summary({ completedUnitCount: 1 }))).toMatchObject({ label: "制作中", tone: "in-progress" });
});
