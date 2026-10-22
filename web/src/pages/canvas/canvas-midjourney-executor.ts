import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import {
    buildGenerationConfig,
    isGenerationCanceled,
    nodeReferenceImage,
    runCanvasGenerationTaskToConsumer,
} from "@/lib/canvas/canvas-project-generation";
import {
    MIDJOURNEY_ACTION_LABELS,
    midjourneyActionFromNode,
    midjourneyIndexForNode,
    midjourneyResultMode,
    midjourneyUpstreamTaskId,
    midjourneyVideoIndexForNode,
    type MidjourneyActionSubmission,
} from "@/lib/canvas/canvas-midjourney";
import { canvasGenerationPromptMetadata } from "@/lib/canvas/canvas-generation-submission";
import { generationErrorMessage } from "@/lib/generation-error";
import { submitMidjourneyModal as submitMidjourneyModalRequest, type GenerationTask } from "@/services/api/task-center";
import { uploadResourceFile } from "@/services/api/resources";
import { persistCanvasGenerationTarget } from "@/services/canvas-generation-target";
import { captureUserScope } from "@/lib/user-scope-guard";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type RunMidjourneyActionOptions = {
    projectId: string;
    parentNodeId: string;
    payload: MidjourneyActionSubmission;
    config: AiConfig;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: (updater: CanvasNodeData[] | ((current: CanvasNodeData[]) => CanvasNodeData[])) => void;
    setConnections: (updater: CanvasConnection[] | ((current: CanvasConnection[]) => CanvasConnection[])) => void;
    setSelectedNodeIds: (ids: Set<string>) => void;
    setSelectedConnectionId: (id: string | null) => void;
    setDialogNodeId: (id: string | null) => void;
    setRunningNodeId: (id: string | null) => void;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    applyGenerationTaskResult: (targetNodeId: string, task: GenerationTask) => Promise<void>;
    notify: (message: string) => void;
    notifyError?: (message: string) => void;
    onInpaintTaskCreated?: (nodeId: string) => void;
};

export async function runMidjourneyCanvasAction(options: RunMidjourneyActionOptions) {
    const parent = options.nodesRef.current.find((node) => node.id === options.parentNodeId);
    if (!parent?.metadata) throw new Error("Midjourney 节点不存在");
    const parentMetadata = parent.metadata;
    const action = options.payload.action;
    if (action === "imagine") throw new Error("Imagine 请使用普通生成入口");
    if (action !== "modal" && !parentMetadata.content) throw new Error("Midjourney 源图片不存在或尚未保存");
    const parentAction = midjourneyActionFromNode(parent);
    const upstreamTaskId = midjourneyUpstreamTaskId(parent);
    const needsParent = parentAction !== "" && action !== "describe" && action !== "edits" && action !== "blend" && !(action === "video" && !upstreamTaskId);
    if (needsParent && !upstreamTaskId) throw new Error("缺少 Midjourney 上游 task_id，请刷新原任务后再操作");
    if (action === "modal" && parentAction !== "inpaint") throw new Error("MODAL 只能接在同一条 inpaint 上游任务之后");
    if (action === "modal" && !options.payload.maskDataUrl) throw new Error("请先涂抹蒙版再提交 MODAL");
    if (action === "modal" && !options.payload.prompt?.trim()) throw new Error("请填写局部重绘要求");
    if (action === "edits" && !options.payload.prompt?.trim()) throw new Error("图片编辑需要提示词");
    if (action === "video" && options.payload.animateMode === "auto" && (parentAction !== "imagine" || !upstreamTaskId)) throw new Error("自动动画需要 imagine 上游 task_id");
    if (action === "modal") return submitMidjourneyModalAction(options, parent);

    const referenceImages = resolveMidjourneyReferences(options, parent, action, options.payload);
    if (action === "blend" && (referenceImages.length < 2 || referenceImages.length > 4)) throw new Error("混合图片需要选择 2–4 张图片");
    if ((action === "describe" || action === "edits") && referenceImages.length === 0) throw new Error("该动作需要一张源图片");

    const resultMode = midjourneyResultMode(action);
    const midjourney = midjourneyRequestOptions(action, upstreamTaskId, parent, options.payload);
    const childId = nanoid();
    const resultType = resultMode === "text" ? CanvasNodeType.Text : resultMode === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
    const defaultSize = NODE_DEFAULT_SIZE[resultType] || NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const childNode: CanvasNodeData = {
        id: childId,
        type: resultType,
        title: `${MIDJOURNEY_ACTION_LABELS[action]} · ${parent.title || "Midjourney"}`,
        position: { x: parent.position.x + parent.width + 96, y: parent.position.y },
        width: defaultSize.width,
        height: defaultSize.height,
        metadata: {
            ...canvasGenerationPromptMetadata(options.payload.prompt?.trim() || parentMetadata.prompt || "", options.payload.prompt?.trim() || parentMetadata.prompt || ""),
            status: "loading",
            generationMode: resultMode,
            model: parentMetadata.model,
            taskProvider: "midjourney",
            midjourneyAction: action,
            midjourneyParentTaskId: upstreamTaskId || undefined,
            midjourneyVersion: options.payload.version || parentMetadata.midjourneyVersion,
            midjourneyStage: action === "inpaint" ? "inpaint" : undefined,
            midjourneyNextAction: action === "inpaint" ? "modal" : undefined,
            midjourneyParameters: midjourney,
            midjourneyMaskSourceNodeId: action === "inpaint" ? parent.id : undefined,
            taskOutputIndex: 0,
        },
    };

    const nextNodes = [...options.nodesRef.current, childNode];
    const linkedNodeIds = action === "blend" ? (options.payload.referenceNodeIds || []) : ["describe", "edits", "video"].includes(action) ? [parent.id] : [];
    const extraConnections = Array.from(new Set(linkedNodeIds))
        .filter((nodeId) => nodeId !== parent.id)
        .map((nodeId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId } satisfies CanvasConnection));
    const nextConnections = [...options.connectionsRef.current, { id: nanoid(), fromNodeId: parent.id, toNodeId: childId } satisfies CanvasConnection, ...extraConnections];
    options.nodesRef.current = nextNodes;
    options.connectionsRef.current = nextConnections;
    options.setNodes(nextNodes);
    options.setConnections(nextConnections);
    options.setSelectedNodeIds(new Set([childId]));
    options.setSelectedConnectionId(null);
    options.setDialogNodeId(null);
    options.setRunningNodeId(childId);

    const controller = options.startGenerationRequest(childId, parent.id, childId);
    const generationConfig = { ...buildGenerationConfig(options.config, parent, "image"), count: "1" };
    const prompt = options.payload.prompt?.trim() || MIDJOURNEY_ACTION_LABELS[action];
    const accepted = deferred<void>();
    let taskAccepted = false;
    const background = runCanvasGenerationTaskToConsumer(
        {
            projectId: options.projectId,
            nodeId: childId,
            mode: "image",
            prompt,
            config: generationConfig,
            referenceImages,
            signal: controller.signal,
            onTaskCreated: () => {
                taskAccepted = true;
                accepted.resolve();
                if (action === "inpaint") setTimeout(() => options.onInpaintTaskCreated?.(childId), 0);
            },
            metadata: {
                sourceNodeId: parent.id,
                edit: `midjourney:${action}`,
                midjourneyParentTaskId: upstreamTaskId || undefined,
                midjourneyAction: action,
                midjourneyVersion: options.payload.version || parentMetadata.midjourneyVersion,
                midjourneyStage: action === "inpaint" ? "inpaint" : undefined,
                midjourneyNextAction: action === "inpaint" ? "modal" : undefined,
                taskOutputIndex: 0,
                midjourney,
            },
        },
        {
            bindTask: (task) => options.bindGenerationTask(childId, task),
            consumeTask: (task) => options.applyGenerationTaskResult(childId, task),
            targetSnapshot: () => ({ nodes: options.nodesRef.current, connections: options.connectionsRef.current }),
        },
    );
    if (action === "inpaint") {
        void background
            .then(() => options.notify("局部重绘任务已完成"))
            .catch((error) => {
                if (!taskAccepted) accepted.reject(error);
                const details = generationErrorMessage(error);
                options.setNodes((current) => current.map((node) => node.id === childId ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: details } } : node));
                options.notifyError?.(details);
            })
            .finally(() => {
                options.finishGenerationRequest(childId, controller);
                options.setRunningNodeId(null);
            });
        await accepted.promise;
        return;
    }
    try {
        await background;
        options.notify(`${MIDJOURNEY_ACTION_LABELS[action]}任务已完成`);
    } catch (error) {
        if (isGenerationCanceled(error) || (error instanceof Error && error.name === "AbortError")) {
            options.setNodes((current) => current.map((node) => node.id === childId ? { ...node, metadata: { ...node.metadata, status: "idle" as const } } : node));
            return;
        }
        const details = generationErrorMessage(error);
        options.setNodes((current) => current.map((node) => node.id === childId ? { ...node, metadata: { ...node.metadata, status: "error" as const, errorDetails: details } } : node));
        throw error;
    } finally {
        options.finishGenerationRequest(childId, controller);
        options.setRunningNodeId(null);
    }
}

async function submitMidjourneyModalAction(options: RunMidjourneyActionOptions, node: CanvasNodeData) {
    const localTaskId = node.metadata?.taskId?.trim();
    const maskDataUrl = options.payload.maskDataUrl;
    const prompt = options.payload.prompt?.trim();
    if (!localTaskId) throw new Error("inpaint 任务尚未保存，请稍后重试");
    if (!maskDataUrl || !prompt) throw new Error("MODAL 需要蒙版和提示词");
    const maskBlob = await (await fetch(maskDataUrl)).blob();
    const resource = await uploadResourceFile(maskBlob, "image", { fileName: "midjourney-mask.png" });
    await submitMidjourneyModalRequest(localTaskId, { prompt, maskResourceId: resource.id });
    const nextNodes = options.nodesRef.current.map((candidate) => candidate.id === node.id
        ? {
              ...candidate,
              metadata: {
                  ...candidate.metadata,
                  status: "loading" as const,
                  midjourneyStage: "modal" as const,
                  midjourneyNextAction: undefined,
                  midjourneyModalSubmittedTaskId: localTaskId,
              },
          }
        : candidate);
    options.nodesRef.current = nextNodes;
    options.setNodes(nextNodes);
    options.setRunningNodeId(node.id);
    try {
        await persistCanvasGenerationTarget({
            projectId: options.projectId,
            nodeId: node.id,
            expectedScope: captureUserScope(),
            nodes: nextNodes,
            connections: options.connectionsRef.current,
        });
    } catch (error) {
        options.notifyError?.("MODAL 已提交，但本地画布保存待同步");
        console.warn("Midjourney MODAL 已提交，本地画布持久化稍后重试", error);
    }
    options.notify("MODAL 已提交，等待原 inpaint 任务返回结果");
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function resolveMidjourneyReferences(
    options: RunMidjourneyActionOptions,
    parent: CanvasNodeData,
    action: MidjourneyActionSubmission["action"],
    payload: MidjourneyActionSubmission,
) {
    if (action === "modal" || !["blend", "describe", "edits", "video"].includes(action)) return [];
    if (action === "video" && payload.animateMode === "auto" && midjourneyActionFromNode(parent) === "imagine" && midjourneyUpstreamTaskId(parent)) return [];
    const nodeIds = action === "blend"
        ? (payload.referenceNodeIds?.length ? payload.referenceNodeIds : [parent.id])
        : [parent.id];
    return nodeIds
        .map((nodeId) => options.nodesRef.current.find((node) => node.id === nodeId))
        .filter((node): node is CanvasNodeData => Boolean(node?.metadata?.content))
        .map((node) => nodeReferenceImage(node))
        .filter((reference): reference is NonNullable<ReturnType<typeof nodeReferenceImage>> => Boolean(reference));
}

function midjourneyRequestOptions(
    action: MidjourneyActionSubmission["action"],
    upstreamTaskId: string,
    parent: CanvasNodeData,
    payload: MidjourneyActionSubmission,
) {
    const autoIndex = midjourneyIndexForNode(parent);
    const options: Record<string, unknown> = { action };
    const parentAction = midjourneyActionFromNode(parent);
    const usesParent = ["upscale", "variation", "high-variation", "low-variation", "reroll", "zoom", "pan", "inpaint", "modal", "remix-strong", "remix-subtle"].includes(action)
        || (action === "video" && payload.animateMode === "auto" && parentAction === "imagine");
    if (usesParent && upstreamTaskId) options.taskId = upstreamTaskId;
    if (payload.customId?.trim()) options.customId = payload.customId.trim();
    if (["upscale", "variation", "high-variation", "low-variation", "inpaint", "remix-strong", "remix-subtle"].includes(action)) {
        options.index = Math.max(1, Math.min(4, Math.floor(Number(payload.index) || autoIndex)));
    }
    if (action === "video" && payload.animateMode === "auto") {
        const requested = Number(payload.index);
        options.index = Number.isFinite(requested) ? Math.max(0, Math.min(3, Math.floor(requested))) : midjourneyVideoIndexForNode(parent);
    }
    if (action === "zoom") options.zoomRatio = Number(payload.zoomRatio) || 2;
    if (action === "pan") options.direction = payload.direction || "right";
    if (action === "blend") options.dimensions = payload.dimensions || "LANDSCAPE";
    if (action === "video") {
        if (payload.animateMode) options.animateMode = payload.animateMode;
        if (payload.videoType?.trim()) options.videoType = payload.videoType.trim();
        if (payload.motion) options.motion = payload.motion;
        if (payload.batchSize) options.batchSize = payload.batchSize;
        if (payload.endUrl?.trim()) options.endUrl = payload.endUrl.trim();
    }
    if (payload.version?.trim()) options.version = payload.version.trim();
    return options;
}

