import type { ProjectDetail, ProjectShot, WorkflowStep } from "@/services/api/projects";

import type { ShortDramaWorkflowStage } from "./workflow-shared";

export type WorkflowProductionWorkbenchProps = {
    activeStage: ShortDramaWorkflowStage;
    detail: ProjectDetail;
    projectId: string;
    unitId: string;
    workflowStep?: WorkflowStep;
    selectedShot?: ProjectShot;
    onSelectShot: (id: string) => void;
    onRefresh: () => Promise<void>;
    onAddShot: () => void;
    addingShot: boolean;
};

export const productionStageCopy: Record<"storyboard" | "previz" | "video", { label: string; action: string; empty: string }> = {
    storyboard: { label: "分镜图", action: "生成分镜图", empty: "生成静态分镜图，确认构图、景别与角色位置" },
    previz: { label: "动作预演", action: "生成黑白预演", empty: "生成黑白动作预演，确认表演节拍与镜头运动" },
    video: { label: "镜头视频", action: "生成镜头视频", empty: "选择视频模型后生成当前镜头" },
};

export const SMART_FILM_TASK_TIMEOUT_MS = 60 * 60 * 1000;
