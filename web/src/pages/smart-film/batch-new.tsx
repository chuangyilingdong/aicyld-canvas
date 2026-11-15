import { useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select } from "antd";
import { ArrowLeft, ImagePlus, Library, LoaderCircle, Palette, Sparkles, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasStylePickerModal, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import type { SmartFilmScriptReference } from "@/lib/canvas/smart-film-scripts";
import { uploadWorkspaceAssetFiles } from "@/services/workspace-asset-upload";
import { createSmartFilmBatch, saveSmartFilmBatchScripts, type SmartFilmReferenceRole } from "@/services/api/smart-film-batches";
import { backendProviderConfig } from "@/services/api/generation-task";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { logicalModelIDForConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { generateSmartFilmScripts } from "./smart-film-script-generation";

import "./smart-film.css";
import "./smart-film-batch.css";

const MAX_BATCH_PRODUCT_IMAGES = 12;
const REFERENCE_ROLE_OPTIONS: Array<{ value: SmartFilmReferenceRole; label: string }> = [
    { value: "product", label: "产品" },
    { value: "scene", label: "场景" },
    { value: "character", label: "人物" },
    { value: "prop", label: "道具" },
    { value: "other", label: "其他" },
];

export default function SmartFilmBatchNewPage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const assets = useAssetStore((state) => state.assets);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [idea, setIdea] = useState("");
    const [productAssetIds, setProductAssetIds] = useState<string[]>([]);
    const [referenceRoles, setReferenceRoles] = useState<Record<string, SmartFilmReferenceRole>>({});
    const [newReferenceRole, setNewReferenceRole] = useState<SmartFilmReferenceRole>("product");
    const [scriptCount, setScriptCount] = useState<number | null>(3);
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [budgetPoints, setBudgetPoints] = useState<number | null>(0);
    const [textModel, setTextModel] = useState("");
    const [imageModel, setImageModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [uploading, setUploading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [status, setStatus] = useState("");
    const productAssets = productAssetIds.flatMap((id) => {
        const asset = assets.find((item) => item.id === id && item.kind === "image");
        return asset ? [asset as ImageAsset] : [];
    });
    const productPickerItems = useMemo<AssetLibraryPickerItem[]>(() => assets
        .filter((asset) => asset.kind === "image" && asset.status !== "archived")
        .map((asset) => ({
            id: asset.id,
            title: asset.title,
            category: normalizeAssetCategory(asset.category),
            kindLabel: "图片",
            mediaKind: "image",
            asset,
            searchText: (asset.tags || []).join(" "),
            folderId: asset.folderId,
        })), [assets]);

    const addProductImages = async (files: File[]) => {
        if (!files.length) return;
        const remaining = MAX_BATCH_PRODUCT_IMAGES - productAssetIds.length;
        if (remaining <= 0) {
            message.warning(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
            return;
        }
        const accepted = files.slice(0, remaining);
        if (accepted.length < files.length) message.warning(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张，已忽略超出部分`);
        setUploading(true);
        try {
            const result = await uploadWorkspaceAssetFiles(accepted, "");
            if (result.addedAssetIds.length) {
                setProductAssetIds((current) => [...new Set([...current, ...result.addedAssetIds])].slice(0, MAX_BATCH_PRODUCT_IMAGES));
                setReferenceRoles((current) => ({ ...current, ...Object.fromEntries(result.addedAssetIds.map((id) => [id, newReferenceRole])) }));
            }
            if (result.failed) message.warning(`${result.failed} 张参考图上传失败`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图上传失败");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const createBatch = async () => {
        const sourceText = idea.trim();
        const resolvedScriptCount = Number(scriptCount) || 0;
        const resolvedTextModel = textModel || effectiveConfig.textModel;
        const resolvedImageModel = imageModel || effectiveConfig.imageModel;
        const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
        if (!sourceText) return message.warning("请先填写视频想法");
        if (resolvedScriptCount < 1 || resolvedScriptCount > 10) return message.warning("剧本数量需要在 1–10 条之间");
        if (productAssetIds.length > MAX_BATCH_PRODUCT_IMAGES) return message.warning(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
        if (!resolvedTextModel || !resolvedImageModel || !resolvedVideoModel) return message.warning("请先选择文本、图片和视频模型");
        if ([resolvedTextModel, resolvedImageModel, resolvedVideoModel].some((model) => !isAiConfigReady(effectiveConfig, model))) {
            return message.warning("所选模型当前不可用，请先检查模型配置");
        }
        setGenerating(true);
        setStatus("正在创建多剧本批次…");
        let batchId = "";
        try {
            const textProvider = { ...backendProviderConfig({ ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel }, "text"), logicalModelId: logicalModelIDForConfig({ ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel }) || undefined };
            const imageProvider = { ...backendProviderConfig({ ...effectiveConfig, model: resolvedImageModel, imageModel: resolvedImageModel }, "image"), logicalModelId: logicalModelIDForConfig({ ...effectiveConfig, model: resolvedImageModel, imageModel: resolvedImageModel }) || undefined };
            const videoProvider = { ...backendProviderConfig({ ...effectiveConfig, model: resolvedVideoModel, videoModel: resolvedVideoModel }, "video"), logicalModelId: logicalModelIDForConfig({ ...effectiveConfig, model: resolvedVideoModel, videoModel: resolvedVideoModel }) || undefined };
            const created = await createSmartFilmBatch({
                title: sourceText.slice(0, 24) || "多剧本智能成片",
                sourceText,
                inputAssetIds: productAssetIds,
                config: {
                    aspectRatio,
                    ...(selectedStyle ? {
                        stylePresetId: selectedStyle.id,
                        styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)),
                    } : {}),
                    defaultTextModel: resolvedTextModel,
                    defaultImageModel: resolvedImageModel,
                    defaultVideoModel: resolvedVideoModel,
                    inputAssetRoles: referenceRoles,
                    scriptCount: resolvedScriptCount,
                },
                budgetPoints: Math.max(0, Math.floor(Number(budgetPoints) || 0)),
                orchestrationConfig: {
                    text: textProvider,
                    image: imageProvider,
                    video: videoProvider,
                },
            });
            batchId = created.batch.id;
            setStatus(`正在生成 ${resolvedScriptCount} 条独立剧本…`);
            const generated = await generateSmartFilmScripts({
                idea: sourceText,
                references: productAssets.map((asset) => ({
                    title: asset.title,
                    role: referenceRoles[asset.id] || "other",
                })) satisfies SmartFilmScriptReference[],
                count: resolvedScriptCount,
                config: { ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel, imageModel: resolvedImageModel, videoModel: resolvedVideoModel },
                batchId,
            });
            setStatus("正在保存剧本候选…");
            await saveSmartFilmBatchScripts(
                batchId,
                generated.scripts.map((script) => ({ title: script.title, content: script.content, taskId: generated.taskId })),
                created.batch.revision,
            );
            navigate(`/smart-film/batches/${batchId}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "多剧本生成失败，请重试");
            if (batchId) navigate(`/smart-film/batches/${batchId}`);
        } finally {
            setGenerating(false);
            setStatus("");
        }
    };

    return (
        <WorkspacePage className="smart-film-page smart-film-batch-page">
            <header className="smart-film-hero">
                <div>
                    <span className="smart-film-eyebrow"><Sparkles className="size-3.5" /> MULTI FILM BATCH</span>
                    <h1>多剧本智能成片</h1>
                    <p>一次生成多条独立剧本，每条对应一条独立视频。后续资产、分镜和视频都在各自项目中确认与生成，互不合并。</p>
                </div>
                <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/smart-film")}>返回智能成片</Button>
            </header>

            <main className="smart-film-batch-form">
                <section className="smart-film-batch-section">
                    <div className="smart-film-batch-section-title"><span>01</span><div><strong>想法与参考素材</strong><small>可上传产品、场景、人物、道具等参考图，后续会进入独立项目的资产提取</small></div></div>
                    <Input.TextArea value={idea} onChange={(event) => setIdea(event.target.value)} autoSize={{ minRows: 5, maxRows: 10 }} placeholder="例如：为这款便携咖啡机做 3 条不同角度的独立短视频，分别突出办公室、露营和早晨通勤。" />
                    <div className="smart-film-reference-role-row">
                        <span>本次添加类型</span>
                        <Select value={newReferenceRole} onChange={setNewReferenceRole} options={REFERENCE_ROLE_OPTIONS} disabled={generating || uploading} />
                        <small>上传或从素材库选择后仍可逐张调整类型。</small>
                    </div>
                    <div className="smart-film-product-grid">
                        {productAssets.map((asset) => (
                            <div className="smart-film-product-card" key={asset.id}>
                                <CachedResourceImage storageKey={asset.data.storageKey} src={asset.data.dataUrl} alt={asset.title} eager />
                                <Select
                                    className="smart-film-product-role"
                                    size="small"
                                    value={referenceRoles[asset.id] || "other"}
                                    options={REFERENCE_ROLE_OPTIONS}
                                    onChange={(role) => setReferenceRoles((current) => ({ ...current, [asset.id]: role }))}
                                    disabled={generating}
                                    aria-label={`${asset.title} 的参考类型`}
                                />
                                <span title={asset.title}>{asset.title}</span>
                                <button type="button" aria-label={`移除 ${asset.title}`} onClick={() => { setProductAssetIds((current) => current.filter((id) => id !== asset.id)); setReferenceRoles((current) => { const next = { ...current }; delete next[asset.id]; return next; }); }}><Trash2 className="size-3.5" /></button>
                            </div>
                        ))}
                        <button className="smart-film-product-add" type="button" disabled={uploading || generating} onClick={() => fileInputRef.current?.click()}>
                            {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
                            <span>{uploading ? "正在上传" : "添加参考图"}</span>
                        </button>
                        <button className="smart-film-product-add" type="button" disabled={generating} onClick={() => setAssetPickerOpen(true)}>
                            <Library className="size-5" />
                            <span>从素材库选择</span>
                        </button>
                    </div>
                    <small className="smart-film-product-hint">最多 {MAX_BATCH_PRODUCT_IMAGES} 张；支持产品、场景、人物和道具图片。</small>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple hidden onChange={(event) => void addProductImages(Array.from(event.target.files || []))} />
                </section>

                <section className="smart-film-batch-section">
                    <div className="smart-film-batch-section-title"><span>02</span><div><strong>剧本与画面规格</strong><small>先确定剧本数量和统一画幅、画风；分镜策略将在剧本确认后设置</small></div></div>
                    <div className="smart-film-batch-number-grid">
                        <label><span>生成剧本数量</span><InputNumber min={1} max={10} precision={0} value={scriptCount} onChange={setScriptCount} addonAfter="条" /></label>
                        <label><span>成片画幅</span><Select value={aspectRatio} onChange={setAspectRatio} disabled={generating} options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} /></label>
                        <label><span>批次预算</span><InputNumber min={0} precision={0} value={budgetPoints} onChange={setBudgetPoints} addonAfter="积分" /></label>
                    </div>
                    <div className="smart-film-batch-style-row">
                        <div>
                            <strong>项目画风</strong>
                            <span>{selectedStyle ? `${selectedStyle.title}，将应用到角色、场景、分镜图和镜头视频提示词` : "未指定时使用模型默认风格；可选择后统一全批次视觉基线"}</span>
                        </div>
                        <Button size="small" icon={<Palette className="size-3.5" />} disabled={generating} onClick={() => setStylePickerOpen(true)}>
                            {selectedStyle ? `画风：${selectedStyle.title}` : "选择画风（可选）"}
                        </Button>
                    </div>
                </section>

                <section className="smart-film-batch-section">
                    <div className="smart-film-batch-section-title"><span>03</span><div><strong>生成模型</strong><small>文本模型用于剧本，图片和视频模型写入每个独立项目</small></div></div>
                    <div className="smart-film-batch-model-grid">
                        <label><span>文本模型</span><ModelPicker config={effectiveConfig} value={textModel || effectiveConfig.textModel} onChange={setTextModel} capability="text" fullWidth variant="creation" placeholder="选择文本模型" /></label>
                        <label><span>图片模型</span><ModelPicker config={effectiveConfig} value={imageModel || effectiveConfig.imageModel} onChange={setImageModel} capability="image" fullWidth variant="creation" placeholder="选择图片模型" /></label>
                        <label><span>视频模型</span><ModelPicker config={effectiveConfig} value={videoModel || effectiveConfig.videoModel} onChange={setVideoModel} capability="video" fullWidth variant="creation" placeholder="选择视频模型" /></label>
                    </div>
                </section>

                <div className="smart-film-batch-submit">
                    <div><strong>确认后生成独立剧本候选</strong><span>每条剧本都可以单独重新生成、修改和选择是否制作。</span></div>
                    <Button type="primary" size="large" loading={generating || uploading} icon={<Sparkles className="size-4" />} onClick={() => void createBatch()}>
                        {generating ? status || "正在生成" : `生成 ${scriptCount || 0} 条剧本`}
                    </Button>
                </div>
            </main>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id || ""}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => {
                    setSelectedStyle(preset);
                    setStylePickerOpen(false);
                }}
            />
            <AssetLibraryPickerModal
                open={assetPickerOpen}
                remoteLibrary
                remoteKind="image"
                items={productPickerItems}
                mediaKinds={["image"]}
                categoryLabels={{ all: "全部图片", ...ASSET_CATEGORY_LABELS }}
                initialSelectedIds={productAssetIds}
                multiple
                eyebrow="参考素材"
                title="从素材库选择参考图"
                confirmLabel={(count) => `使用已选参考图${count ? `（${count}）` : ""}`}
                emptyTitle="素材库还没有可用图片"
                emptyDescription="先上传参考图，或返回素材库整理图片后重试。"
                footerNote={`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张，只会使用当前账号拥有的图片。`}
                onClose={() => setAssetPickerOpen(false)}
                onConfirm={async (ids) => {
                    if (ids.length > MAX_BATCH_PRODUCT_IMAGES) throw new Error(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
                    setProductAssetIds([...new Set(ids)].slice(0, MAX_BATCH_PRODUCT_IMAGES));
                    setReferenceRoles((current) => {
                        const next: Record<string, SmartFilmReferenceRole> = {};
                        ids.slice(0, MAX_BATCH_PRODUCT_IMAGES).forEach((id) => { next[id] = current[id] || newReferenceRole; });
                        return next;
                    });
                    setAssetPickerOpen(false);
                }}
            />
        </WorkspacePage>
    );
}
