import { expect, test } from "bun:test";

import { projectOverviewStageStates, projectSummaryStage } from "@/lib/project-workbench";
import type { ProjectOverviewMetrics, ProjectSummary } from "@/services/api/projects";

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

function metrics(overrides: Partial<ProjectOverviewMetrics> = {}): ProjectOverviewMetrics {
    return {
        unitCount: 0,
        completedUnitCount: 0,
        totalWordCount: 0,
        unitsWithoutText: 0,
        unitsWithoutShots: 0,
        canvasCount: 0,
        assetCount: 0,
        shotCount: 0,
        pendingCandidateCount: 0,
        readyStoryboardCount: 0,
        readyPrevizCount: 0,
        readyVideoCount: 0,
        renderSucceededCount: 0,
        staleArtifactCount: 0,
        ...overrides,
    };
}

test("存在镜头不等于分镜阶段已完成", () => {
    expect(projectOverviewStageStates(metrics({ shotCount: 3 })).storyboard).toBe("active");
    expect(projectOverviewStageStates(metrics({ shotCount: 3, readyStoryboardCount: 3 })).storyboard).toBe("completed");
});

test("待确认资产会阻止资产阶段显示完成", () => {
    expect(projectOverviewStageStates(metrics({ unitCount: 1, assetCount: 3, pendingCandidateCount: 2 })).assets).toBe("attention");
});

test("只有存在有效交付产物时才标记交付完成", () => {
    expect(projectOverviewStageStates(metrics({ shotCount: 3, readyVideoCount: 1 })).delivery).toBe("active");
    expect(projectOverviewStageStates(metrics({ shotCount: 3, renderSucceededCount: 1 })).delivery).toBe("completed");
});
