import { App } from "antd";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { ASSET_CATEGORY_LABELS, type AssetCategory } from "@/lib/asset-category";
import { resourceFileUrl } from "@/services/api/resources";
import type { ShotArtifact, ShotAssetReference } from "@/services/api/projects";
import { uploadWorkspaceAssetFiles } from "@/services/workspace-asset-upload";

export type AssetPickerTarget =
    | { mode: "add"; category: AssetCategory }
    | { mode: "replace"; category: AssetCategory; reference: ShotAssetReference };

export function WorkflowWorkbenchOverlays({
    imagePreviewArtifact,
    onCloseImagePreview,
    assetPickerTarget,
    assetPickerItems,
    bindingAssets,
    onCloseAssetPicker,
    onConfirmAssets,
}: {
    imagePreviewArtifact: ShotArtifact | null;
    onCloseImagePreview: () => void;
    assetPickerTarget: AssetPickerTarget | null;
    assetPickerItems: AssetLibraryPickerItem[];
    bindingAssets: boolean;
    onCloseAssetPicker: () => void;
    onConfirmAssets: (ids: string[], target: AssetPickerTarget) => Promise<void>;
}) {
    const { message } = App.useApp();
    return <>
        <AppModal
            flush
            open={Boolean(imagePreviewArtifact?.resourceId)}
            title={imagePreviewArtifact?.type === "action_board" ? "动作预演预览" : "分镜图预览"}
            footer={null}
            centered
            width="min(960px, calc(100vw - 32px))"
            maskClosable={false}
            onCancel={onCloseImagePreview}
        >
            {imagePreviewArtifact?.resourceId ? <img className={`workflow-image-preview-modal ${imagePreviewArtifact.type === "action_board" ? "grayscale" : ""}`} src={resourceFileUrl(imagePreviewArtifact.resourceId)} alt={imagePreviewArtifact.type === "action_board" ? "动作预演大图" : "分镜图大图"} /> : null}
        </AppModal>

        <AssetLibraryPickerModal
            open={Boolean(assetPickerTarget)}
            remoteLibrary
            mediaKinds={["image", "video", "audio", "text"]}
            items={assetPickerItems}
            categoryLabels={{ all: "全部素材", ...ASSET_CATEGORY_LABELS }}
            multiple={assetPickerTarget?.mode !== "replace"}
            eyebrow={assetPickerTarget?.mode === "replace" ? "替换镜头资产" : `添加${assetPickerTarget ? ASSET_CATEGORY_LABELS[assetPickerTarget.category] : "资产"}`}
            title={assetPickerTarget?.mode === "replace" ? "选择替换资产" : "从画布或素材库选择"}
            confirmLabel={(count) => assetPickerTarget?.mode === "replace" ? "替换资产" : `添加到当前镜头${count ? `（${count}）` : ""}`}
            emptyTitle="还没有可用资产"
            emptyDescription="可以直接从本地上传图片、视频或音频；上传后会自动出现在当前镜头。"
            upload={{
                accept: "image/*,video/*,audio/*",
                description: "支持本地图片、视频和音频，上传后自动加入素材库",
                onUpload: async (files) => {
                    const result = await uploadWorkspaceAssetFiles(Array.from(files), "");
                    if (result.failed || result.persistenceError) message.warning(`已上传 ${result.completed} 个，${result.failed || 1} 个未完成`);
                    if (!result.addedAssetIds.length) throw new Error("本地资产上传失败，请重试");
                    return result.addedAssetIds;
                },
            }}
            onClose={onCloseAssetPicker}
            onConfirm={async (ids) => {
                if (!assetPickerTarget) throw new Error("请选择资产用途");
                if (bindingAssets) return;
                await onConfirmAssets(ids, assetPickerTarget);
            }}
        />
    </>;
}
