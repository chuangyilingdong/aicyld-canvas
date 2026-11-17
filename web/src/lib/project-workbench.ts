import type { ProjectDetail, ProjectOverviewMetrics, ProjectStatusSnapshot, ProjectSummary, ProjectUnit } from "@/services/api/projects";

export type ProjectActionTone = "default" | "attention" | "danger";

export type ProjectWorkbenchAction = {
    id: string;
    title: string;
    description: string;
    href: string;
    actionLabel: string;
    tone: ProjectActionTone;
};

export type ProjectContinueTarget = {
    href: string;
    title: string;
    context: string;
    updatedAt: string;
};

export type ProjectStageCell = {
    label: string;
    state: "idle" | "active" | "attention" | "completed";
};

export type ProjectOverviewStageState = "idle" | "active" | "attention" | "completed";

export type ProjectOverviewStageStates = {
    story: ProjectOverviewStageState;
    assets: ProjectOverviewStageState;
    storyboard: ProjectOverviewStageState;
    previz: ProjectOverviewStageState;
    video: ProjectOverviewStageState;
    delivery: ProjectOverviewStageState;
};

export type ProjectUnitStage = {
    unit: ProjectUnit;
    content: ProjectStageCell;
    assets: ProjectStageCell;
    storyboard: ProjectStageCell;
    canvas: ProjectStageCell;
};

export function projectSummaryStage(summary: ProjectSummary): ProjectStatusSnapshot {
    return summary.status;
}

export function projectOverviewStageStates(metrics: ProjectOverviewMetrics): ProjectOverviewStageStates {
    const story = metrics.unitCount === 0
        ? "idle"
        : metrics.unitsWithoutText > 0
          ? "attention"
          : "completed";
    const assets = metrics.pendingCandidateCount > 0
        ? "attention"
        : metrics.assetCount > 0
          ? "completed"
          : metrics.unitCount > 0
            ? "active"
            : "idle";
    const storyboard = metrics.shotCount > 0 && metrics.readyStoryboardCount === metrics.shotCount
        ? "completed"
        : metrics.shotCount > 0
          ? metrics.staleArtifactCount > 0
            ? "attention"
            : "active"
          : "idle";
    const smartWholeFilm = metrics.productionMode === "smart";
    const previz = smartWholeFilm
        ? "completed"
        : metrics.shotCount > 0 && metrics.readyPrevizCount === metrics.shotCount
          ? "completed"
          : metrics.shotCount > 0
            ? "active"
            : "idle";
    const video = smartWholeFilm
        ? metrics.readySmartFilmCount > 0
            ? "completed"
            : metrics.shotCount > 0 && metrics.readyStoryboardCount === metrics.shotCount
              ? "active"
              : "idle"
        : metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount
          ? "completed"
          : metrics.readyVideoCount > 0
            ? "active"
            : "idle";
    const delivery = metrics.deliveryReady
        ? "completed"
        : metrics.readyVideoCount > 0 || metrics.readySmartFilmCount > 0 || metrics.renderSucceededCount > 0
          ? "active"
          : "idle";
    return { story, assets, storyboard, previz, video, delivery };
}

export function projectAttentionCount(detail: ProjectDetail) {
    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation").length;
    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed").length;
    return pendingCandidates + failedSteps;
}

export function projectContinueTarget(detail: ProjectDetail): ProjectContinueTarget {
    const latestCanvas = [...detail.canvases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const latestUnit = [...detail.units].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (latestCanvas && (!latestUnit || latestCanvas.updatedAt >= latestUnit.updatedAt)) {
        return {
            href: `/canvas/${latestCanvas.id}`,
            title: latestCanvas.title,
            context: "继续编辑项目画布",
            updatedAt: latestCanvas.updatedAt,
        };
    }
    if (latestUnit) {
        return {
            href: `/projects/${detail.project.id}/chapters/${latestUnit.id}`,
            title: latestUnit.title,
            context: "继续处理剧情章节",
            updatedAt: latestUnit.updatedAt,
        };
    }
    return {
        href: `/projects/${detail.project.id}/chapters`,
        title: detail.project.name,
        context: "从剧情章节开始",
        updatedAt: detail.project.updatedAt,
    };
}

// 项目概览必须把真实阻塞转成动作；没有事实依据时只提示通用的制作下一步。
export function projectNextActions(detail: ProjectDetail, limit = 4): ProjectWorkbenchAction[] {
    const actions: ProjectWorkbenchAction[] = [];
    const projectRoot = `/projects/${detail.project.id}`;
    if (detail.project.status === "archived") {
        return [{
            id: "restore-project",
            title: "项目已归档",
            description: "恢复后才能创建画布和提交生成任务。",
            href: `${projectRoot}/settings`,
            actionLabel: "前往恢复",
            tone: "attention",
        }];
    }

    const failedSteps = detail.workflows.flatMap((workflow) => workflow.steps).filter((step) => step.status === "failed");
    if (failedSteps.length) {
        const firstUnitId = [...detail.units].sort(byPosition)[0]?.id;
        const failedHref = firstUnitId
            ? `${projectRoot}/workflow/${firstUnitId}/${failedSteps[0].stepKey}`
            : `${projectRoot}/overview`;
        actions.push({
            id: "failed-steps",
            title: `处理 ${failedSteps.length} 个失败步骤`,
            description: failedSteps[0].error?.trim() || "查看失败原因和输入后，仅重试受影响的任务。",
            href: failedHref,
            actionLabel: "处理失败步骤",
            tone: "danger",
        });
    }

    const pendingCandidates = detail.assetCandidates.filter((candidate) => candidate.status === "pending_confirmation");
    if (pendingCandidates.length) {
        const categories = new Set(pendingCandidates.map((candidate) => candidate.category));
        actions.push({
            id: "pending-assets",
            title: `确认 ${pendingCandidates.length} 个资产候选`,
            description: `${categories.size} 类角色、场景或制作资产需要确认后才能稳定复用。`,
            href: `${projectRoot}/assets`,
            actionLabel: "去确认",
            tone: "attention",
        });
    }

    if (!detail.units.length) {
        actions.push({
            id: "add-story",
            title: "添加第一个剧情章节",
            description: "导入小说、粘贴文本，或从空白章节开始。",
            href: `${projectRoot}/chapters`,
            actionLabel: "添加章节",
            tone: "default",
        });
    } else {
        const firstDraft = [...detail.units].sort(byPosition).find((unit) => unit.status === "draft");
        if (firstDraft) {
            actions.push({
                id: `review-unit-${firstDraft.id}`,
                title: `确认第 ${firstDraft.position + 1} 章内容`,
                description: firstDraft.title,
                href: `${projectRoot}/chapters/${firstDraft.id}`,
                actionLabel: "继续处理",
                tone: "default",
            });
        }

        const unitsWithShots = new Set(detail.shots.map((shot) => shot.unitId).filter(Boolean));
        const firstUnitWithoutShots = [...detail.units].sort(byPosition).find((unit) => unit.status !== "draft" && !unitsWithShots.has(unit.id));
        if (firstUnitWithoutShots) {
            actions.push({
                id: `storyboard-unit-${firstUnitWithoutShots.id}`,
                title: `为第 ${firstUnitWithoutShots.position + 1} 章建立分镜`,
                description: `${firstUnitWithoutShots.title}还没有镜头，可先生成分镜草稿再逐项调整。`,
                href: `${projectRoot}/chapters/${firstUnitWithoutShots.id}`,
                actionLabel: "建立分镜",
                tone: "default",
            });
        }
    }

    if (!detail.canvases.length && detail.units.length) {
        actions.push({
            id: "create-canvas",
            title: "建立第一张项目画布",
            description: "把章节、分镜和参考资产放进同一个制作空间。",
            href: `${projectRoot}/overview`,
            actionLabel: "返回制作概览",
            tone: "default",
        });
    }

    if (!actions.length) {
        const target = projectContinueTarget(detail);
        actions.push({
            id: "continue-project",
            title: "继续最近的制作内容",
            description: `${target.context}：${target.title}`,
            href: target.href,
            actionLabel: "继续创作",
            tone: "default",
        });
    }
    return actions.slice(0, limit);
}

export function projectUnitStages(detail: ProjectDetail, limit = 8): ProjectUnitStage[] {
    const sortedUnits = [...detail.units].sort(byPosition).slice(0, limit);
    return sortedUnits.map((unit) => {
        const candidates = detail.assetCandidates.filter((candidate) => candidate.unitId === unit.id);
        const pendingCandidates = candidates.filter((candidate) => candidate.status === "pending_confirmation").length;
        const confirmedCandidates = candidates.filter((candidate) => candidate.status === "confirmed").length;
        const shots = detail.shots.filter((shot) => shot.unitId === unit.id);
        const canvasCount = new Set(detail.canvasUnitLinks.filter((link) => link.unitId === unit.id).map((link) => link.canvasId)).size;
        return {
            unit,
            content: contentStage(unit),
            assets: pendingCandidates
                ? { label: `${pendingCandidates} 待确认`, state: "attention" }
                : confirmedCandidates
                  ? { label: `${confirmedCandidates} 已确认`, state: "completed" }
                  : { label: "未识别", state: "idle" },
            storyboard: shots.length
                ? { label: `${shots.length} 镜头`, state: shots.every((shot) => shot.status === "completed") ? "completed" : "active" }
                : { label: "未开始", state: "idle" },
            canvas: canvasCount
                ? { label: `${canvasCount} 张`, state: "active" }
                : { label: "未关联", state: "idle" },
        };
    });
}

function contentStage(unit: ProjectUnit): ProjectStageCell {
    if (unit.status === "completed") return { label: "已完成", state: "completed" };
    if (unit.status === "ready") return { label: "待制作", state: "active" };
    return { label: "草稿", state: "attention" };
}

function byPosition(left: ProjectUnit, right: ProjectUnit) {
    return left.position - right.position;
}
