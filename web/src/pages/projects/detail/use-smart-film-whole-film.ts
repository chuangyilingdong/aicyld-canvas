import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { confirmCanvasGenerationTaskQuote } from "@/components/canvas/canvas-billing-confirmation";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { buildBackendGenerationTaskQuoteInput, runBackendGenerationTask } from "@/services/api/generation-task";
import { listProjectUnitArtifacts, registerProjectUnitArtifact, type ProjectDetail, type ProjectShot } from "@/services/api/projects";
import { ownedResourceIdFromMediaRef, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { getSmartFilmBatch } from "@/services/api/smart-film-batches";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { currentArtifact, currentRevision } from "./workflow-shared";

export function useSmartFilmWholeFilm(detail: ProjectDetail, projectId: string, unitId: string, shots: ProjectShot[]) {
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [smartFilmGenerating, setSmartFilmGenerating] = useState(false);
    const smartFilmBatchQuery = useQuery({
        queryKey: ["smart-film-batch", detail.project.batchId],
        queryFn: () => getSmartFilmBatch(detail.project.batchId!).then((result) => result.batch),
        enabled: Boolean(detail.project.batchId),
    });
    const smartWholeFilm = smartFilmBatchQuery.data?.config.productionMode === "smart";
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

    const generateSmartWholeFilm = async (confirmQuote: (input: ReturnType<typeof buildBackendGenerationTaskQuoteInput>) => Promise<boolean>, notifyError: (message: string) => void) => {
        if (smartFilmGenerating) return;
        const storyboardArtifacts = shots.flatMap((shot) => {
            const artifact = currentArtifact(detail, shot.id, "storyboard");
            return artifact?.resourceId && artifact.status === "ready" ? [{ shot, artifact }] : [];
        });
        if (storyboardArtifacts.length !== shots.length || !storyboardArtifacts.length) {
            notifyError("请先确认全部分镜提示词并生成、确认每一张分镜图");
            return;
        }
        const model = detail.project.defaultVideoModel || effectiveConfig.videoModel;
        if (!model || !isAiConfigReady(effectiveConfig, model)) {
            notifyError("当前项目没有可用的视频模型");
            return;
        }
        const profile = modelCapabilityConfigFor(effectiveConfig, model).video;
        const maxImages = profile?.references.maxImages || 0;
        if (storyboardArtifacts.length > maxImages) {
            notifyError(`当前视频模型最多支持 ${maxImages} 张参考图，本项目有 ${storyboardArtifacts.length} 张分镜图，请更换支持更多参考图的模型`);
            return;
        }
        const targetSeconds = Number(smartFilmBatchQuery.data?.config.targetDurationSeconds || 0);
        if (targetSeconds <= 0) {
            notifyError("智能整片缺少目标总时长，请返回批次设置制作规格");
            return;
        }
        const maxTargetSeconds = profile?.duration.max || targetSeconds;
        if (targetSeconds > maxTargetSeconds) {
            notifyError(`当前视频模型单次最多生成 ${maxTargetSeconds} 秒，无法直接生成 ${targetSeconds} 秒整片`);
            return;
        }
        const storyboardPrompt = storyboardArtifacts.map(({ shot }, index) => {
            const revision = currentRevision(detail, shot);
            const motion = [revision?.videoPrompt, revision?.action].filter(Boolean).join("\n");
            const seconds = Math.max(0.5, shot.durationMs / 1000);
            return `第 ${index + 1} 镜（计划 ${seconds} 秒，使用第 ${index + 1} 张分镜图）：${motion || revision?.plotDescription || shot.description || shot.title}`;
        }).join("\n");
        let taskId = "";
        const options: Parameters<typeof buildBackendGenerationTaskQuoteInput>[0] = {
            projectId,
            mode: "video",
            prompt: `把以下已确认分镜图按顺序生成一个完整的 ${targetSeconds} 秒视频。保持角色、产品、场景和画风一致，镜头之间自然衔接。\n${storyboardPrompt}`,
            config: { ...effectiveConfig, model, videoModel: model, size: detail.project.aspectRatio, videoSeconds: String(targetSeconds) },
            referenceImages: storyboardArtifacts.map(({ shot, artifact }, index) => ({
                id: `smart-film-storyboard-${index}`,
                name: `分镜 ${index + 1} · ${shot.title}`,
                type: "image/*",
                dataUrl: "",
                url: resourceFileUrl(artifact.resourceId!),
                storageKey: `resource:${artifact.resourceId}`,
            })),
            metadata: { source: "smart-film-whole-video", domainProjectId: projectId, unitId, artifactType: "smart_film" },
            onTaskUpdate: (task) => { taskId = task.id; },
        };
        if (!(await confirmQuote(buildBackendGenerationTaskQuoteInput(options)))) return;
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
                    storyboardResourceIds: storyboardArtifacts.map(({ artifact }) => artifact.resourceId),
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

    return { smartWholeFilm, smartFilmGenerating, latestSmartWholeFilm, readyStoryboardCount, smartFilmBatch: smartFilmBatchQuery.data, generateSmartWholeFilm };
}
