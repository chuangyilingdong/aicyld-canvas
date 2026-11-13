export type CanvasStarterMode = "guided" | "freeform";

export type CanvasEmptyStateKind = "none" | "guided" | "freeform" | "linked";

export function resolveCanvasEmptyStateKind({
    nodeCount,
    shortDramaEnabled,
    isProjectLinked,
    starterMode,
}: {
    nodeCount: number;
    shortDramaEnabled: boolean;
    isProjectLinked: boolean;
    starterMode?: CanvasStarterMode;
}): CanvasEmptyStateKind {
    if (nodeCount > 0) return "none";
    if (!shortDramaEnabled) return "freeform";
    if (isProjectLinked) return "linked";
    // BeefTV 默认直接进入自由节点状态；短剧引导只保留给显式设置过
    // starterMode=guided 的历史画布，不在新建流程中强制插入选择步骤。
    return starterMode === "guided" ? "guided" : "freeform";
}
