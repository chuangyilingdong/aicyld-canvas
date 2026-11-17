import { useEffect, useMemo, useRef, useState } from "react";
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
import { approvedStoryboardArtifact, currentArtifact } from "./workflow-shared";
import { buildSmartFilmWholeFilmPrompt } from "./smart-film-whole-film-prompt";
import { smartFilmSkillMetadata, smartFilmSkillStagePrompt } from "@/services/smart-film-skill";

export function useSmartFilmWholeFilm(detail: ProjectDetail, projectId: string, unitId: string, shots: ProjectShot[], activeStage: string) {
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [smartFilmGenerating, setSmartFilmGenerating] = useState(false);
    const [smartFilmTask, setSmartFilmTask] = useState<GenerationTask | null>(null);
    const [smartFilmRecoveryError, setSmartFilmRecoveryError] = useState("");
    const recoveringTaskIdsRef = useRef(new Set<string>());
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
    const readyStoryboardCount = useMemo(
        () => shots.filter((shot) => {
            const artifact = currentArtifact(detail, shot.id, "storyboard");
            return artifact?.resourceId && artifact.status === "ready";
        }).length,
        [detail, shots],
    );
    const latestSmartFilmTask = useMemo(() => {
        const merged = new Map<string, GenerationTask>();
        for (const task of [...(detail.tasks || []), ...(projectTasksQuery.data || [])]) merged.set(task.id, task);
        return Array.from(merged.values())
            .filter((task) => task.projectId === projectId && task.type === "canvas_video"
                && (task.clientContext?.artifactType === "smart_film" || task.clientContext?.source === "smart-film-whole-video"))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    }, [detail.tasks, projectId, projectTasksQuery.data]);
    const activeSmartFilmTask = latestSmartFilmTask?.status === "queued" || latestSmartFilmTask?.status === "running" ? latestSmartFilmTask : undefined;

    useEffect(() => {
        const task = latestSmartFilmTask;
        if (!task || task.status !== "succeeded" || !unitArtifactsQuery.isSuccess || recoveringTaskIdsRef.current.has(task.id)) return;
        if ((unitArtifactsQuery.data || []).some((artifact) => artifact.taskId === task.id)) return;
        recoveringTaskIdsRef.current.add(task.id);
        void (async () => {
            try {
                const result = parseBackendGenerationResult(task);
                const resourceId = ownedResourceIdFromMediaRef(result.video?.storageKey, result.video?.url) || resourceIdFromStorageKey(result.video?.storageKey);
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
                recoveringTaskIdsRef.current.delete(task.id);
                setSmartFilmRecoveryError(error instanceof Error ? error.message : "整片视频产物恢复失败");
            }
        })();
    }, [latestSmartFilmTask, projectId, unitArtifactsQuery, unitId]);

    const generateSmartWholeFilm = async (confirmQuote: (input: ReturnType<typeof buildBackendGenerationTaskQuoteInput>) => Promise<boolean>, notifyError: (message: string) => void) => {
        if (smartFilmGenerating) return;
        const unconfirmedShots = shots.filter((shot) => shot.status !== "confirmed");
        if (unconfirmedShots.length) {
            notifyError(`还有 ${unconfirmedShots.length} 个镜头的参考分镜未确认，请逐镜确认后再生成整片`);
            return;
        }
        const storyboardArtifacts = shots.flatMap((shot) => {
            const artifact = currentArtifact(detail, shot.id, "storyboard");
            return artifact?.resourceId && artifact.status === "ready" ? [{ shot, artifact }] : [];
        });
        if (storyboardArtifacts.length !== shots.length || !storyboardArtifacts.length) {
            notifyError("请先确认全部分镜提示词并生成、确认每一张分镜图");
            return;
        }
        const unapprovedShots = shots.filter((shot) => !approvedStoryboardArtifact(detail, shot));
        if (unapprovedShots.length) {
            notifyError(`还有 ${unapprovedShots.length} 个镜头的分镜图未确认，请逐镜确认后再生成整片`);
            return;
        }
        const model = detail.project.defaultVideoModel || effectiveConfig.videoModel;
        if (!model || !isAiConfigReady(effectiveConfig, model)) {
            notifyError("当前项目没有可用的视频模型");
            return;
        }
        const profile = modelCapabilityConfigFor(effectiveConfig, model).video;
        const maxImages = profile?.references.maxImages || 0;
        const targetSeconds = Number(smartFilmBatchQuery.data?.config.targetDurationSeconds || 0);
        if (targetSeconds <= 0) {
            notifyError("智能整片缺少目标总时长，请返回批次设置制作规格");
            return;
        }
        const promptPlan = buildSmartFilmWholeFilmPrompt(detail, storyboardArtifacts, targetSeconds);
        const skillSnapshot = smartFilmBatchQuery.data?.config.skillSnapshot;
        if (skillSnapshot && !skillSnapshot.stages?.video) {
            notifyError(`技能「${skillSnapshot.name}」缺少整片视频阶段规则`);
            return;
        }
        const prompt = smartFilmSkillStagePrompt(skillSnapshot, "video", promptPlan.prompt);
        if (promptPlan.referenceImages.length > maxImages) {
            notifyError(`当前视频模型最多支持 ${maxImages} 张参考图，本片包含 ${storyboardArtifacts.length} 张分镜图和 ${promptPlan.referenceImages.length - storyboardArtifacts.length} 张镜头资产图，请更换支持更多参考图的模型`);
            return;
        }
        const maxTargetSeconds = profile?.duration.max || targetSeconds;
        if (targetSeconds > maxTargetSeconds) {
            notifyError(`当前视频模型单次最多生成 ${maxTargetSeconds} 秒，无法直接生成 ${targetSeconds} 秒整片`);
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
        if (!(await confirmQuote(buildBackendGenerationTaskQuoteInput(options)))) return;
        setSmartFilmTask(null);
        setSmartFilmGenerating(true);
        try {
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
            notifyError(error instanceof Error ? error.message : "智能整片生成失败");
        } finally {
            setSmartFilmGenerating(false);
        }
    };

    return { smartWholeFilm, smartFilmConfigurationPending, smartFilmGenerating, smartFilmTask: smartFilmTask || latestSmartFilmTask, smartFilmRecoveryError, latestSmartWholeFilm, readyStoryboardCount, smartFilmBatch: smartFilmBatchQuery.data, generateSmartWholeFilm };
}
