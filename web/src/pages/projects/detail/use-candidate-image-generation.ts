import { useState } from "react";
import { App } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { confirmCanvasGenerationTaskQuote } from "@/components/canvas/canvas-billing-confirmation";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { buildBackendGenerationTaskQuoteInput, runBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectCore, updateProjectAssetCandidatePreview, type ProjectAsset, type ProjectAssetCandidate } from "@/services/api/projects";
import { ownedResourceIdFromMediaRef, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { ApiError } from "@/services/api/request";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { assetCandidateImagePrompt } from "./asset-candidate-prompt-modal";

async function updatePreviewWithLatestRevision(projectId: string, candidateId: string, input: Omit<Parameters<typeof updateProjectAssetCandidatePreview>[2], "expectedRevision">) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const latest = await getProjectCore(projectId);
        try {
            return await updateProjectAssetCandidatePreview(projectId, candidateId, { ...input, expectedRevision: latest.project.revision });
        } catch (error) {
            if (attempt < 3 && error instanceof ApiError && (error.code === 409 || error.status === 409)) continue;
            throw error;
        }
    }
    throw new Error("资产图结果保存冲突，请刷新后重试");
}

export function useCandidateImageGeneration({ projectId, stylePresetId, styleProfileJson, assets, refreshProject }: {
    projectId: string;
    stylePresetId?: string;
    styleProfileJson?: string;
    assets: ProjectAsset[];
    refreshProject: () => void;
}) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
    const mutation = useMutation({
        mutationFn: async (candidate: ProjectAssetCandidate) => {
            const model = effectiveConfig.imageModel || effectiveConfig.model;
            const config = { ...effectiveConfig, model };
            if (!isAiConfigReady(config, model)) throw new Error("请先在设置中配置可用的图片模型");
            const style = resolveProjectCanvasStyle(stylePresetId, styleProfileJson);
            const referenceImages = assets.flatMap((asset) => {
                if (asset.mediaType !== "image" || !asset.storageKey) return [];
                const resourceId = resourceIdFromStorageKey(asset.storageKey);
                return [{ id: asset.id, name: asset.title, type: "image/*", dataUrl: "", storageKey: asset.storageKey, ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}) }];
            }).slice(0, 4);
            let taskId = "";
            let taskSnapshot: { model?: string; billingPoints?: number } | undefined;
            const generationOptions: Parameters<typeof buildBackendGenerationTaskQuoteInput>[0] = {
                projectId,
                mode: "image",
                prompt: assetCandidateImagePrompt(candidate, style?.prompt || ""),
                config,
                referenceImages,
                metadata: { source: "asset_candidate_preview", candidateId: candidate.id, unitId: candidate.unitId || "" },
                onTaskUpdate: (task) => { taskId = task.id; taskSnapshot = { model: task.model, billingPoints: task.billingPoints }; },
            };
            if (!(await confirmCanvasGenerationTaskQuote(modal, buildBackendGenerationTaskQuoteInput(generationOptions), {
                title: "确认生成资产图",
                description: `资产：${candidate.name || "未命名资产"}`,
            }))) throw new Error("已取消生成资产图");
            try {
                const result = await runBackendGenerationTask(generationOptions);
                const image = result.images?.[0];
                const resourceId = ownedResourceIdFromMediaRef(image?.storageKey, image?.url) || resourceIdFromStorageKey(image?.storageKey);
                if (!resourceId) throw new Error("资产图已生成，但没有取得可保存的图片资源");
                await updatePreviewWithLatestRevision(projectId, candidate.id, {
                    resourceId, taskId, model: taskSnapshot?.model || model,
                    points: Math.max(0, Math.floor(taskSnapshot?.billingPoints || 0)),
                    status: "ready", selected: true,
                });
                return resourceId;
            } catch (error) {
                if (taskId) {
                    try {
                        await updatePreviewWithLatestRevision(projectId, candidate.id, {
                            resourceId: "", taskId, model: taskSnapshot?.model || model,
                            points: Math.max(0, Math.floor(taskSnapshot?.billingPoints || 0)), status: "failed",
                            error: error instanceof Error ? error.message : "资产图生成失败", selected: false,
                        });
                    } catch {
                        // The original generation error remains actionable.
                    }
                }
                throw error;
            }
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["project", projectId, "asset-candidates"] }),
                queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
            ]);
            refreshProject();
            message.success("资产图已生成，可预览后确认");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "资产图生成失败"),
    });
    const generate = async (candidate: ProjectAssetCandidate) => {
        if (generatingIds.has(candidate.id)) return;
        setGeneratingIds((current) => new Set(current).add(candidate.id));
        try { await mutation.mutateAsync(candidate); } catch { /* onError owns the message */ }
        finally {
            setGeneratingIds((current) => {
                const next = new Set(current);
                next.delete(candidate.id);
                return next;
            });
        }
    };
    return { generatingIds, generate };
}
