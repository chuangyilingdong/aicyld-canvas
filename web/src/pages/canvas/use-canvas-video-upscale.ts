import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { captureUserScope } from "@/lib/user-scope-guard";
import { createVideoUpscaleTask, type VideoUpscaleQuality, type VideoUpscaleResolution } from "@/services/api/media-upscale";
import { queryGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type VideoUpscaleRequest = {
    nodeId: string;
    sourceNodeId: string;
    resourceId: string;
    resolution: VideoUpscaleResolution;
    quality: VideoUpscaleQuality;
};

type UseCanvasVideoUpscaleOptions = {
    projectId: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    applyGenerationTaskResult: (nodeId: string, task: GenerationTask) => Promise<void>;
};

export function useCanvasVideoUpscale({ projectId, nodesRef, setNodes, bindGenerationTask, applyGenerationTaskResult }: UseCanvasVideoUpscaleOptions) {
    const controllersRef = useRef(new Map<string, AbortController>());
    const activeRef = useRef(new Set<string>());

    useEffect(() => () => {
        controllersRef.current.forEach((controller) => controller.abort());
        controllersRef.current.clear();
        activeRef.current.clear();
    }, [projectId]);

    return useCallback(async ({ nodeId, sourceNodeId, resourceId, resolution, quality }: VideoUpscaleRequest) => {
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
                    processingLabel: "正在提交 Topaz 视频超分",
                    errorDetails: undefined,
                    generationSubmissionState: "submitting" as const,
                    taskClientOperationId: clientOperationId,
                    videoUpscale: {
                        ...node.metadata?.videoUpscale,
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
            task = await createVideoUpscaleTask({
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
                const latest = await queryGenerationTask(createdTask.id, { expectedScope }).catch(() => createdTask);
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
