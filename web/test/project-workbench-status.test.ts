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
        status: {
            label: "草稿",
            detail: "还没有开始制作",
            tone: "draft",
            activeTaskCount: 0,
            failedStepCount: 0,
            pendingCandidateCount: 0,
            staleArtifactCount: 0,
            deliveryReady: false,
        },
        ...overrides,
    };
}

test("项目卡片直接使用后端状态快照", () => {
    const status = {
        label: "生成中",
        detail: "2 个生成任务正在运行",
        tone: "generating" as const,
        activeTaskCount: 2,
        failedStepCount: 0,
        pendingCandidateCount: 0,
        staleArtifactCount: 0,
        deliveryReady: false,
    };
    expect(projectSummaryStage(summary({ status }))).toBe(status);
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
        activeTaskCount: 0,
        failedStepCount: 0,
        runningStepCount: 0,
        readySmartFilmCount: 0,
        deliveryReady: false,
        productionMode: "fixed",
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

test("只有后端确认当前交付有效时才标记交付完成", () => {
    expect(projectOverviewStageStates(metrics({ shotCount: 3, readyVideoCount: 1 })).delivery).toBe("active");
    expect(projectOverviewStageStates(metrics({ shotCount: 3, renderSucceededCount: 1, staleArtifactCount: 1 })).delivery).toBe("active");
    expect(projectOverviewStageStates(metrics({ shotCount: 3, renderSucceededCount: 1, deliveryReady: true })).delivery).toBe("completed");
});

test("智能整片使用整片产物而不是逐镜视频判断视频阶段", () => {
    expect(projectOverviewStageStates(metrics({ productionMode: "smart", shotCount: 3, readyStoryboardCount: 3, readyVideoCount: 0, readySmartFilmCount: 1 })).video).toBe("completed");
});
