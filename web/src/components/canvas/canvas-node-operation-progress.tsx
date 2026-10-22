import { useEffect, useState } from "react";
import { Clock3, FileText, Square } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { operationProgressView, type OperationProgress } from "@/lib/operation-progress";
import type { GenerationTask } from "@/services/api/task-center";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasNodeOperationProgress({
    node,
    theme,
    operation,
    onOpenTaskDetails,
    onCancelTask,
}: {
    node: CanvasNodeData;
    theme: CanvasTheme;
    operation: OperationProgress;
    onOpenTaskDetails?: (node: CanvasNodeData) => void;
    onCancelTask?: (node: CanvasNodeData) => void;
}) {
    const now = useSecondTick(Boolean(operation.target?.taskId));
    const view = operationProgressView(operation, now);
    const taskStatus = (node.metadata?.taskStatus || "running") as GenerationTask["status"];
    const showTaskControls = Boolean(operation.target?.taskId);

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" style={{ background: theme.node.fill, color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="max-w-full text-[var(--fs-tiny)] font-semibold break-words">{operation.title}</span>
            <div className="flex w-full max-w-[210px] flex-col items-center gap-1.5">
                {view.timing ? (
                    <div className="max-w-full truncate text-sm font-semibold tabular-nums" style={{ color: theme.node.text }}>
                        <Clock3 className="mr-1 inline size-3.5 align-[-2px]" />{view.timing}
                    </div>
                ) : null}
                {view.percent !== null ? <div className="max-w-full truncate text-[var(--fs-label)] font-medium" style={{ color: theme.node.text }}>{view.percent}%</div> : null}
                {view.percent !== null ? (
                    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }} role="progressbar" aria-label={operation.detail} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}>
                        <div className="h-full rounded-full transition-[width]" style={{ width: `${view.percent}%`, background: theme.node.activeStroke }} />
                    </div>
                ) : (
                    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }} role="progressbar" aria-label={operation.detail}>
                        <div className="canvas-node-progress-indeterminate h-full rounded-full" style={{ background: theme.node.activeStroke }} />
                    </div>
                )}
                <div className="max-w-full text-[var(--fs-tiny)] break-words" style={{ color: theme.node.muted }}>{operation.detail}</div>
                {view.size || view.speed || view.count ? <div className="max-w-full truncate text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>{[view.size, view.speed, view.count].filter(Boolean).join(" · ")}</div> : null}
                {showTaskControls ? <div className="mt-0.5 flex items-center gap-1.5">
                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[var(--fs-tiny)] font-medium transition-colors" style={{ background: theme.toolbar.itemHover, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenTaskDetails?.(node); }}><FileText className="size-3" />详情</button>
                    {onCancelTask && (taskStatus === "queued" || taskStatus === "running" || taskStatus === "succeeded") ? (
                        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[var(--fs-tiny)] font-medium transition-colors" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCancelTask(node); }} aria-label={taskStatus === "succeeded" ? "停止取回结果" : "取消生成任务"}>
                            <Square className="size-3" />{taskStatus === "succeeded" ? "停止取回" : "取消"}
                        </button>
                    ) : null}
                </div> : null}
            </div>
        </div>
    );
}

function useSecondTick(active: boolean) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!active) return;
        const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
        return () => window.clearInterval(timer);
    }, [active]);
    return Date.now();
}
