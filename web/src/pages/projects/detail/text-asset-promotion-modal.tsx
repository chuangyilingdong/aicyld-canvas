import { useEffect, useState } from "react";
import { App, Input, Modal } from "antd";
import { useMutation } from "@tanstack/react-query";

import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import { confirmCanvasGenerationTaskQuote } from "@/components/canvas/canvas-billing-confirmation";
import { buildBackendGenerationTaskQuoteInput, runBackendGenerationTask } from "@/services/api/generation-task";
import { getProjectCore, promoteProjectAssetVisual, type ProjectAsset, type ProjectDetail } from "@/services/api/projects";
import { ownedResourceIdFromMediaRef, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { categoryLabel } from "./shared";

export function TextAssetPromotionModal({ open, detail, asset, onClose, onPromoted }: {
    open: boolean;
    detail: ProjectDetail;
    asset: ProjectAsset | null;
    onClose: () => void;
    onPromoted: (asset: ProjectAsset) => void;
}) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [prompt, setPrompt] = useState("");
    const style = resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson);
    useEffect(() => {
        if (open && asset) setPrompt(textAssetPromotionPrompt(asset, style?.prompt || ""));
    }, [asset, open, style?.prompt]);
    const mutation = useMutation({
        mutationFn: async () => {
            if (!asset) throw new Error("请选择文本设定资产");
            const nextPrompt = prompt.trim();
            if (!nextPrompt) throw new Error("请输入资产图提示词");
            const model = effectiveConfig.imageModel || effectiveConfig.model;
            const config = { ...effectiveConfig, model };
            if (!isAiConfigReady(config, model)) throw new Error("请先在设置中配置可用的图片模型");
            const referenceImages = detail.assets.flatMap((item) => {
                if (item.mediaType !== "image" || !item.storageKey) return [];
                const resourceId = resourceIdFromStorageKey(item.storageKey);
                return [{ id: item.id, name: item.title, type: "image/*", dataUrl: "", storageKey: item.storageKey, ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}) }];
            }).slice(0, 4);
            let taskId = "";
            let taskSnapshot: { model?: string } | undefined;
            const options: Parameters<typeof buildBackendGenerationTaskQuoteInput>[0] = {
                projectId: detail.project.id,
                mode: "image",
                prompt: nextPrompt,
                config,
                referenceImages,
                metadata: { source: "asset_text_promotion", assetId: asset.id },
                onTaskUpdate: (task) => { taskId = task.id; taskSnapshot = { model: task.model }; },
            };
            if (!(await confirmCanvasGenerationTaskQuote(modal, buildBackendGenerationTaskQuoteInput(options), {
                title: "确认生成资产图",
                description: `将把“${asset.title}”从文本设定升级为视觉资产。`,
            }))) throw new Error("已取消生成资产图");
            const result = await runBackendGenerationTask(options);
            const image = result.images?.[0];
            const resourceId = ownedResourceIdFromMediaRef(image?.storageKey, image?.url) || resourceIdFromStorageKey(image?.storageKey);
            if (!resourceId) throw new Error("资产图已生成，但没有取得可保存的图片资源");
            const latest = await getProjectCore(detail.project.id);
            const promoted = await promoteProjectAssetVisual(detail.project.id, asset.id, {
                resourceId,
                taskId,
                model: taskSnapshot?.model || model,
                prompt: nextPrompt,
                expectedRevision: latest.project.revision,
            });
            return promoted.asset;
        },
        onSuccess: (promoted) => {
            onPromoted(promoted);
            onClose();
            message.success("资产图已生成，当前资产已升级为视觉参考资产");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "资产图生成失败"),
    });
    return (
        <Modal className="workspace-modal" title="生成资产图并升级为视觉资产" open={open} okText="生成资产图" cancelText="取消" confirmLoading={mutation.isPending} okButtonProps={{ disabled: !prompt.trim() }} onCancel={() => { if (!mutation.isPending) onClose(); }} onOk={() => mutation.mutate()}>
            <div className="grid gap-3 pt-2 text-sm text-foreground/65">
                <p>系统会先生成资产图并展示费用确认；确认采用后，当前文本资产会新增一个图片版本，并自动使相关镜头回到待确认状态。旧版本会保留。</p>
                <Input.TextArea value={prompt} autoSize={{ minRows: 6, maxRows: 12 }} maxLength={8000} showCount placeholder="描述资产外观、材质、构图和需要保持一致的细节" onChange={(event) => setPrompt(event.target.value)} />
            </div>
        </Modal>
    );
}

function textAssetPromotionPrompt(asset: ProjectAsset, projectStyle: string) {
    return [
        `生成一张用于短视频制作的${categoryLabel(asset.category)}资产设定图。`,
        `资产名称：${asset.title}`,
        asset.previewText ? `文字设定：${asset.previewText}` : `请根据名称补全${categoryLabel(asset.category)}的稳定外观、材质和关键识别特征。`,
        projectStyle ? `项目画风：${projectStyle}` : "",
        "画面只展示资产本身，构图完整、背景干净、光线清晰，适合作为后续分镜的视觉参考。",
        "不要出现文字、水印、边框、拼贴说明或多主体。",
    ].filter(Boolean).join("\n");
}
