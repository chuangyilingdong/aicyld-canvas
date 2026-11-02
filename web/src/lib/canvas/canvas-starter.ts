export type CanvasStarterMode = "guided" | "freeform";
export type CanvasStarterPreset = CanvasStarterMode | "sample";

export type CanvasEmptyStateKind = "none" | "guided" | "freeform" | "linked";

export function parseCanvasStarterPreset(value: string | null | undefined): CanvasStarterPreset | null {
    return value === "guided" || value === "freeform" || value === "sample" ? value : null;
}

export function starterModeForPreset(preset: CanvasStarterPreset): CanvasStarterMode {
    return preset === "freeform" ? "freeform" : "guided";
}

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
    // 兼容旧画布：没有显式选择时仍进入自由画布；新创建流程会写入 starterMode。
    return starterMode === "guided" ? "guided" : "freeform";
}
