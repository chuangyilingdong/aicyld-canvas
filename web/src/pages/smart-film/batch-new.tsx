import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select } from "antd";
import { ArrowLeft, ImagePlus, Library, LoaderCircle, Palette, Sparkles, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasStylePickerModal, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory } from "@/lib/asset-category";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import {
    normalizeSmartFilmShotCount,
    resizeSmartFilmShotDurations,
    smartFilmDefaultShotSeconds,
    smartFilmDurationOptions,
    smartFilmMaxClipSeconds,
} from "@/lib/canvas/smart-film-options";
import { uploadWorkspaceAssetFiles } from "@/services/workspace-asset-upload";
import { createSmartFilmBatch, saveSmartFilmBatchScripts } from "@/services/api/smart-film-batches";
import { backendProviderConfig } from "@/services/api/generation-task";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { logicalModelIDForConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { generateSmartFilmScripts } from "./smart-film-script-generation";

import "./smart-film.css";
import "./smart-film-batch.css";

const MAX_BATCH_PRODUCT_IMAGES = 12;

export default function SmartFilmBatchNewPage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const assets = useAssetStore((state) => state.assets);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [idea, setIdea] = useState("");
    const [productAssetIds, setProductAssetIds] = useState<string[]>([]);
    const [scriptCount, setScriptCount] = useState<number | null>(3);
    const [shotCount, setShotCount] = useState<number | null>(6);
    const [shotDurations, setShotDurations] = useState<number[]>([]);
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
    const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
    const videoProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, resolvedVideoModel).video, [effectiveConfig, resolvedVideoModel]);
    const durationOptions = useMemo(() => smartFilmDurationOptions(videoProfile), [videoProfile]);
    const defaultShotSeconds = smartFilmDefaultShotSeconds(videoProfile);
    const maxClipSeconds = smartFilmMaxClipSeconds(videoProfile);
    const normalizedShotCount = normalizeSmartFilmShotCount(shotCount);
    const totalDurationSeconds = shotDurations.reduce((total, value) => total + value, 0);
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

    useEffect(() => {
        setShotDurations((previous) => resizeSmartFilmShotDurations(previous, normalizedShotCount, videoProfile));
    }, [normalizedShotCount, videoProfile]);

    const addProductImages = async (files: File[]) => {
        if (!files.length) return;
        const remaining = MAX_BATCH_PRODUCT_IMAGES - productAssetIds.length;
        if (remaining <= 0) {
            message.warning(`产品参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
            return;
        }
        const accepted = files.slice(0, remaining);
        if (accepted.length < files.length) message.warning(`产品参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张，已忽略超出部分`);
        setUploading(true);
        try {
            const result = await uploadWorkspaceAssetFiles(accepted, "");
            if (result.addedAssetIds.length) setProductAssetIds((current) => [...new Set([...current, ...result.addedAssetIds])].slice(0, MAX_BATCH_PRODUCT_IMAGES));
            if (result.failed) message.warning(`${result.failed} 张产品图上传失败`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "产品图上传失败");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const createBatch = async () => {
        const sourceText = idea.trim();
        const resolvedScriptCount = Number(scriptCount) || 0;
        const resolvedShotCount = Number(shotCount) || 0;
        const resolvedShotDurations = resizeSmartFilmShotDurations(shotDurations, resolvedShotCount, videoProfile);
        const resolvedShotDuration = resolvedShotDurations[0] || defaultShotSeconds;
        const resolvedTextModel = textModel || effectiveConfig.textModel;
        const resolvedImageModel = imageModel || effectiveConfig.imageModel;
        const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
        if (!sourceText) return message.warning("请先填写视频想法");
        if (resolvedScriptCount < 1 || resolvedScriptCount > 10) return message.warning("剧本数量需要在 1–10 条之间");
        if (resolvedShotCount < 1 || resolvedShotCount > 200) return message.warning("每条视频的分镜数量需要在 1–200 之间");
        if (!resolvedShotDurations.length || resolvedShotDurations.some((duration) => duration <= 0 || duration > maxClipSeconds)) {
            return message.warning(`逐镜时长必须使用当前视频模型支持的选项，且不超过 ${maxClipSeconds} 秒`);
        }
        if (productAssetIds.length > MAX_BATCH_PRODUCT_IMAGES) return message.warning(`产品参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
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
                    scriptCount: resolvedScriptCount,
                    shotCount: resolvedShotCount,
                    shotDurationSeconds: resolvedShotDuration,
                    shotDurationsSeconds: resolvedShotDurations,
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
                productTitles: productAssets.map((asset) => asset.title),
                count: resolvedScriptCount,
                shotCount: resolvedShotCount,
                shotDurationSeconds: resolvedShotDuration,
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
                    <div className="smart-film-batch-section-title"><span>01</span><div><strong>想法与产品参考</strong><small>产品图会关联到每条独立视频项目，并自动进入分镜参考</small></div></div>
                    <Input.TextArea value={idea} onChange={(event) => setIdea(event.target.value)} autoSize={{ minRows: 5, maxRows: 10 }} placeholder="例如：为这款便携咖啡机做 3 条不同角度的独立短视频，分别突出办公室、露营和早晨通勤。" />
                    <div className="smart-film-product-grid">
                        {productAssets.map((asset) => (
                            <div className="smart-film-product-card" key={asset.id}>
                                <CachedResourceImage storageKey={asset.data.storageKey} src={asset.data.dataUrl} alt={asset.title} eager />
                                <span title={asset.title}>{asset.title}</span>
                                <button type="button" aria-label={`移除 ${asset.title}`} onClick={() => setProductAssetIds((current) => current.filter((id) => id !== asset.id))}><Trash2 className="size-3.5" /></button>
                            </div>
                        ))}
                        <button className="smart-film-product-add" type="button" disabled={uploading || generating} onClick={() => fileInputRef.current?.click()}>
                            {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
                            <span>{uploading ? "正在上传" : "添加产品图"}</span>
                        </button>
                        <button className="smart-film-product-add" type="button" disabled={generating} onClick={() => setAssetPickerOpen(true)}>
                            <Library className="size-5" />
                            <span>从素材库选择</span>
                        </button>
                    </div>
                    <small className="smart-film-product-hint">最多 {MAX_BATCH_PRODUCT_IMAGES} 张；只接受当前账号素材库中的图片。</small>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple hidden onChange={(event) => void addProductImages(Array.from(event.target.files || []))} />
                </section>

                <section className="smart-film-batch-section">
                    <div className="smart-film-batch-section-title"><span>02</span><div><strong>剧本与画面规格</strong><small>画幅、画风和逐镜时长会写入每条独立视频项目</small></div></div>
                    <div className="smart-film-batch-number-grid">
                        <label><span>生成剧本数量</span><InputNumber min={1} max={10} precision={0} value={scriptCount} onChange={setScriptCount} addonAfter="条" /></label>
                        <label><span>每条视频分镜数</span><InputNumber min={1} max={200} precision={0} value={shotCount} onChange={setShotCount} addonAfter="镜" /></label>
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
                    <section className="smart-film-duration-section">
                        <div className="smart-film-duration-heading">
                            <div>
                                <strong>每个分镜时长</strong>
                                <span>当前视频模型单镜上限：{maxClipSeconds} 秒 · 预计总时长 {totalDurationSeconds} 秒</span>
                            </div>
                            <span className="smart-film-duration-hint">逐镜可调，分镜 Worker 会严格使用这里确认的时长</span>
                        </div>
                        <div className="smart-film-duration-grid">
                            {shotDurations.map((duration, index) => (
                                <label key={index}>
                                    <span>镜头 {index + 1}</span>
                                    <Select
                                        value={duration}
                                        disabled={generating}
                                        options={durationOptions.map((value) => ({ value, label: `${value} 秒` }))}
                                        onChange={(value) => setShotDurations((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))}
                                    />
                                </label>
                            ))}
                        </div>
                    </section>
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
                eyebrow="产品参考"
                title="从素材库选择产品图"
                confirmLabel={(count) => `使用已选产品图${count ? `（${count}）` : ""}`}
                emptyTitle="素材库还没有可用图片"
                emptyDescription="先上传产品图，或返回素材库整理图片后重试。"
                footerNote={`产品参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张，只会使用当前账号拥有的图片。`}
                onClose={() => setAssetPickerOpen(false)}
                onConfirm={async (ids) => {
                    if (ids.length > MAX_BATCH_PRODUCT_IMAGES) throw new Error(`产品参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
                    setProductAssetIds([...new Set(ids)].slice(0, MAX_BATCH_PRODUCT_IMAGES));
                    setAssetPickerOpen(false);
                }}
            />
        </WorkspacePage>
    );
}
