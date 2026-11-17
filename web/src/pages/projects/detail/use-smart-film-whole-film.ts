import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { modelCapabilityConfigFor, normalizeVideoValue } from "@/lib/model-capabilities";
import { resolveModelVideoBooleanOptions } from "@/lib/model-selection";
import { buildBackendGenerationTaskQuoteInput, parseBackendGenerationResult, runBackendGenerationTask } from "@/services/api/generation-task";
import { listProjectUnitArtifacts, registerProjectUnitArtifact, type ProjectDetail, type ProjectShot } from "@/services/api/projects";
import { ownedResourceIdFromMediaRef, resourceIdFromStorageKey } from "@/services/api/resources";
import { getSmartFilmBatch } from "@/services/api/smart-film-batches";
import { listGenerationTasks, type GenerationTask } from "@/services/api/task-center";
import type { SmartFilmSkillStage } from "@/services/api/smart-film-batches";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { currentArtifact } from "./workflow-shared";
import { buildSmartFilmEditPrompt } from "./smart-film-edit-prompt";
import { buildSmartFilmWholeFilmPrompt } from "./smart-film-whole-film-prompt";
import { smartFilmSkillMetadata } from "@/services/smart-film-skill";

const recoveringSmartFilmTaskKeys = new Set<string>();

export function useSmartFilmWholeFilm(detail: ProjectDetail, projectId: string, unitId: string, shots: ProjectShot[], activeStage: string) {
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [smartFilmGenerating, setSmartFilmGenerating] = useState(false);
    const [smartFilmTask, setSmartFilmTask] = useState<GenerationTask | null>(null);
    const [smartFilmRecoveryError, setSmartFilmRecoveryError] = useState("");
    const [smartFilmError, setSmartFilmError] = useState("");
    const smartFilmBatchQuery = useQuery({
        queryKey: ["smart-film-batch", detail.project.batchId, activeStage === "video" ? "video" : "image"],
        queryFn: () => getSmartFilmBatch(detail.project.batchId!, undefined, (activeStage === "video" ? "video" : "image") as SmartFilmSkillStage).then((result) => result.batch),
        enabled: Boolean(detail.project.batchId),
    });
    const smartWholeFilm = smartFilmBatchQuery.data?.config.productionMode === "smart";
    const smartFilmConfigurationPending = Boolean(detail.project.batchId) && smartFilmBatchQuery.isPending;
    const projectTasksQuery = useQuery({
        queryKey: ["project-generation-tasks", projectId, "smart-film"],
        queryFn: ({ signal }) => listGenerationTasks(30, { projectId }, undefined, signal),
        enabled: Boolean(projectId),
        refetchInterval: smartWholeFilm ? 3_000 : 5_000,
        refetchIntervalInBackground: true,
        staleTime: 1_000,
    });
    const unitArtifactsQuery = useQuery({
        queryKey: ["project-unit-artifacts", projectId, unitId],
        queryFn: ({ signal }) => listProjectUnitArtifacts(projectId, unitId, signal).then((result) => result.artifacts),
        enabled: smartWholeFilm,
    });
    const latestSmartWholeFilm = useMemo(
        () => (unitArtifactsQuery.data || []).filter((artifact) => artifact.type === "smart_film" && artifact.resourceId).sort((left, right) => right.version - left.version)[0],
        [unitArtifactsQuery.data],
    );
    const smartFilmEditPrompt = useMemo(() => {
        if (!latestSmartWholeFilm?.resourceId) return "";
        const entries = shots.flatMap((shot) => {
            const artifact = currentArtifact(detail, shot.id, "storyboard");
            return artifact?.resourceId && artifact.status === "ready" ? [{ shot, artifact }] : [];
        });
        if (!entries.length) return "";
        const targetSeconds = Number(smartFilmBatchQuery.data?.config.targetDurationSeconds || 0);
        if (!(targetSeconds > 0)) return "";
        const skillSnapshot = smartFilmBatchQuery.data?.config.skillSnapshot;
        return buildSmartFilmEditPrompt({
            detail,
            shots,
            entries,
            targetSeconds,
            videoResourceId: latestSmartWholeFilm.resourceId,
            taskId: latestSmartWholeFilm.taskId,
            skillName: skillSnapshot?.stages?.edit ? skillSnapshot.name : "",
        });
    }, [detail, latestSmartWholeFilm, shots, smartFilmBatchQuery.data]);
    const readyStoryboardCount = useMemo(
        () => shots.filter((shot) => {
            const artifact = currentArtifact(detail, shot.id, "storyboard");
            return artifact?.resourceId && artifact.status === "ready";
        }).length,
        [detail, shots],
    );
    const latestSmartFilmTask = useMemo(() => {
        const merged = new Map<string, GenerationTask>();
        for (const task of [...(detail.tasks || []), ...(projectTasksQuery.data || [])]) {
            const current = merged.get(task.id);
            merged.set(task.id, { ...current, ...task, clientContext: task.clientContext || current?.clientContext });
        }
        return Array.from(merged.values())
            .filter((task) => task.projectId === projectId && task.type === "canvas_video"
                && (task.clientContext?.artifactType === "smart_film"
                    || task.clientContext?.source === "smart-film-whole-video"
                    || task.outputs?.some((output) => output.targetBinding?.source === "smart-film-whole-video")))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    }, [detail.tasks, projectId, projectTasksQuery.data]);
    const activeSmartFilmTask = latestSmartFilmTask?.status === "queued" || latestSmartFilmTask?.status === "running" ? latestSmartFilmTask : undefined;

    useEffect(() => {
        const task = latestSmartFilmTask;
        const recoveryKey = `${projectId}:${unitId}:${task?.id || ""}`;
        if (!task || task.status !== "succeeded" || !unitArtifactsQuery.isSuccess || recoveringSmartFilmTaskKeys.has(recoveryKey)) return;
        if ((unitArtifactsQuery.data || []).some((artifact) => artifact.taskId === task.id)) return;
        recoveringSmartFilmTaskKeys.add(recoveryKey);
        void (async () => {
            try {
                const output = task.outputs?.find((item) => item.mediaType === "video" && (item.resourceId || item.targetBinding?.source === "smart-film-whole-video"));
                let resourceId = output?.resourceId || "";
                if (!resourceId) {
                    const result = parseBackendGenerationResult(task);
                    resourceId = ownedResourceIdFromMediaRef(result.video?.storageKey, result.video?.url) || resourceIdFromStorageKey(result.video?.storageKey);
                }
                if (!resourceId) throw new Error("任务已完成，但没有取得可登记的整片视频资源");
                await registerProjectUnitArtifact(projectId, unitId, {
                    taskId: task.id,
                    resourceId,
                    type: "smart_film",
                    metadataJson: JSON.stringify({ recoveredFromTask: true, model: task.model || "", resultState: task.resultState || "" }),
                });
                setSmartFilmRecoveryError("");
                await unitArtifactsQuery.refetch();
            } catch (error) {
                recoveringSmartFilmTaskKeys.delete(recoveryKey);
                setSmartFilmRecoveryError(error instanceof Error ? error.message : "整片视频产物恢复失败");
            }
        })();
    }, [latestSmartFilmTask, projectId, unitArtifactsQuery, unitId]);

    const generateSmartWholeFilm = async (confirmQuote: (input: ReturnType<typeof buildBackendGenerationTaskQuoteInput>) => Promise<boolean>, notifyError: (message: string) => void) => {
        if (smartFilmGenerating) return;
        setSmartFilmError("");
        const fail = (message: string) => {
            setSmartFilmError(message);
            notifyError(message);
        };
        const storyboardArtifacts = shots.flatMap((shot) => {
            const artifact = currentArtifact(detail, shot.id, "storyboard");
            return artifact?.resourceId && artifact.status === "ready" ? [{ shot, artifact }] : [];
        });
        if (storyboardArtifacts.length !== shots.length || !storyboardArtifacts.length) {
            fail("请先生成全部镜头，并确保每一个镜头都有可用的分镜图");
            return;
        }
        const model = detail.project.defaultVideoModel || effectiveConfig.videoModel;
        if (!model || !isAiConfigReady(effectiveConfig, model)) {
            fail("当前项目没有可用的视频模型");
            return;
        }
        const profile = modelCapabilityConfigFor(effectiveConfig, model).video;
        const maxImages = profile?.references.maxImages || 0;
        const targetSeconds = Number(smartFilmBatchQuery.data?.config.targetDurationSeconds || 0);
        if (targetSeconds <= 0) {
            fail("智能整片缺少目标总时长，请返回批次设置制作规格");
            return;
        }
        const promptLimit = profile?.references.promptMaxChars || 4_000;
        const promptPlan = buildSmartFilmWholeFilmPrompt(
            detail,
            storyboardArtifacts,
            targetSeconds,
            { maxChars: promptLimit },
        );
        const skillSnapshot = smartFilmBatchQuery.data?.config.skillSnapshot;
        const prompt = promptPlan.prompt;
        if (promptPlan.referenceImages.length > maxImages) {
            fail(maxImages < storyboardArtifacts.length
                ? `当前视频模型最多支持 ${maxImages} 张参考图，本片有 ${storyboardArtifacts.length} 张分镜图，请更换支持更多参考图的模型`
                : `当前视频模型最多支持 ${maxImages} 张参考图，本片需要 ${promptPlan.referenceImages.length} 张，请更换支持更多参考图的模型`);
            return;
        }
        const maxTargetSeconds = profile?.duration.max || targetSeconds;
        if (targetSeconds > maxTargetSeconds) {
            fail(`当前视频模型单次最多生成 ${maxTargetSeconds} 秒，无法直接生成 ${targetSeconds} 秒整片`);
            return;
        }
        const normalizedVideo = profile
            ? normalizeVideoValue(profile, {
                  seconds: String(targetSeconds),
                  ratio: detail.project.aspectRatio,
                  resolution: effectiveConfig.vquality,
              })
            : { seconds: String(targetSeconds), ratio: detail.project.aspectRatio, resolution: effectiveConfig.vquality };
        const videoBooleanOptions = resolveModelVideoBooleanOptions(effectiveConfig, model, {}, {
            videoGenerateAudio: effectiveConfig.videoGenerateAudio,
            videoWatermark: effectiveConfig.videoWatermark,
        });
        let taskId = "";
        const options: Parameters<typeof buildBackendGenerationTaskQuoteInput>[0] = {
            projectId,
            mode: "video",
            prompt,
            config: {
                ...effectiveConfig,
                model,
                videoModel: model,
                size: normalizedVideo.ratio,
                vquality: normalizedVideo.resolution,
                videoSeconds: normalizedVideo.seconds,
                ...videoBooleanOptions,
            },
            referenceImages: promptPlan.referenceImages,
            metadata: { source: "smart-film-whole-video", domainProjectId: projectId, unitId, artifactType: "smart_film", ...smartFilmSkillMetadata(skillSnapshot) },
            onTaskUpdate: (task) => {
                taskId = task.id;
                setSmartFilmTask(task);
            },
        };
        setSmartFilmGenerating(true);
        try {
            if (!(await confirmQuote(buildBackendGenerationTaskQuoteInput(options)))) return;
            setSmartFilmTask(null);
            const result = await runBackendGenerationTask(options);
            const resourceId = ownedResourceIdFromMediaRef(result.video?.storageKey, result.video?.url) || resourceIdFromStorageKey(result.video?.storageKey);
            if (!taskId || !resourceId) throw new Error("智能整片已生成，但没有取得可登记的完整视频资源");
            await registerProjectUnitArtifact(projectId, unitId, {
                taskId,
                resourceId,
                type: "smart_film",
                metadataJson: JSON.stringify({
                    model,
                    targetDurationSeconds: targetSeconds,
                    storyboardResourceIds: promptPlan.storyboardResourceIds,
                    shotIds: storyboardArtifacts.map(({ shot }) => shot.id),
                }),
            });
            await unitArtifactsQuery.refetch();
        } catch (error) {
            fail(error instanceof Error ? error.message : "智能整片生成失败");
        } finally {
            setSmartFilmGenerating(false);
        }
    };

    return { smartWholeFilm, smartFilmConfigurationPending, smartFilmGenerating, smartFilmError, smartFilmTask: smartFilmTask || latestSmartFilmTask, smartFilmRecoveryError, latestSmartWholeFilm, smartFilmEditPrompt, readyStoryboardCount, smartFilmBatch: smartFilmBatchQuery.data, generateSmartWholeFilm };
}
