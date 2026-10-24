import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { captureUserScope } from "@/lib/user-scope-guard";
import { createUpscaleTask, recoverUpscaleTask, type UpscaleQuality, type UpscaleResolution } from "@/services/api/media-upscale";
import { waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type MediaUpscaleRequest = {
    nodeId: string;
    sourceNodeId: string;
    resourceId: string;
    model: string;
    resolution?: UpscaleResolution;
    quality?: UpscaleQuality;
};

type UseCanvasMediaUpscaleOptions = {
    projectId: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    applyGenerationTaskResult: (nodeId: string, task: GenerationTask) => Promise<void>;
};

export function useCanvasMediaUpscale({ projectId, nodesRef, setNodes, bindGenerationTask, applyGenerationTaskResult }: UseCanvasMediaUpscaleOptions) {
    const controllersRef = useRef(new Map<string, AbortController>());
    const activeRef = useRef(new Set<string>());

    useEffect(() => () => {
        controllersRef.current.forEach((controller) => controller.abort());
        controllersRef.current.clear();
        activeRef.current.clear();
    }, [projectId]);

    return useCallback(async ({ nodeId, sourceNodeId, resourceId, model, resolution, quality }: MediaUpscaleRequest) => {
        const target = nodesRef.current.find((node) => node.id === nodeId && node.type === CanvasNodeType.Upscale);
        if (!target || activeRef.current.has(nodeId)) return;
        activeRef.current.add(nodeId);
        const controller = new AbortController();
        controllersRef.current.set(nodeId, controller);
        const expectedScope = captureUserScope();
        const clientOperationId = `upscale:${resourceId}:${crypto.randomUUID()}`;
        let task: GenerationTask | undefined;
        setNodes((current) => {
            const next = current.map((node) => node.id === nodeId ? {
                ...node,
                metadata: {
                    ...node.metadata,
                    status: "loading" as const,
                    processingLabel: "正在提交媒体超分",
                    errorDetails: undefined,
                    generationSubmissionState: "submitting" as const,
                    taskClientOperationId: clientOperationId,
                    mediaUpscale: {
                        ...node.metadata?.mediaUpscale,
                        model,
                        resolution,
                        quality,
                        sourceNodeId,
                        sourceResourceId: resourceId,
                    },
                },
            } : node);
            nodesRef.current = next;
            return next;
        });
        try {
            task = await createUpscaleTask({
                model,
                resourceId,
                resolution,
                quality,
                clientOperationId,
                projectId,
                nodeId,
            });
            bindGenerationTask(nodeId, task);
            const completed = await waitForGenerationTask(task.id, {
                initialTask: task,
                signal: controller.signal,
                expectedScope,
                onTaskUpdate: (next) => bindGenerationTask(nodeId, next),
            });
            bindGenerationTask(nodeId, completed);
            await applyGenerationTaskResult(nodeId, completed);
        } catch (error) {
            if (controller.signal.aborted) return;
            const createdTask = task;
            if (createdTask) {
                const latest = await recoverUpscaleTask(createdTask.id, expectedScope).catch(() => createdTask);
                bindGenerationTask(nodeId, latest);
                return;
            }
            setNodes((current) => {
                const next = current.map((node) => node.id === nodeId ? {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        status: "error" as const,
                        generationSubmissionState: "unknown" as const,
                        taskStage: "提交结果待确认",
                        errorDetails: error instanceof Error ? `${error.message}。请先到任务中心核对原任务，暂勿重复提交。` : "提交状态待确认，请先到任务中心查询，暂勿重复提交。",
                    },
                } : node);
                nodesRef.current = next;
                return next;
            });
        } finally {
            controllersRef.current.delete(nodeId);
            activeRef.current.delete(nodeId);
        }
    }, [applyGenerationTaskResult, bindGenerationTask, nodesRef, projectId, setNodes]);
}
