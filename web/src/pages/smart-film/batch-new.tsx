import { useRef, useState } from "react";
import { App, Button, Input, InputNumber } from "antd";
import { ArrowLeft, ImagePlus, LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { uploadWorkspaceAssetFiles } from "@/services/workspace-asset-upload";
import { createSmartFilmBatch, saveSmartFilmBatchScripts } from "@/services/api/smart-film-batches";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { generateSmartFilmScripts } from "./smart-film-script-generation";

import "./smart-film.css";
import "./smart-film-batch.css";

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
    const [shotDurationSeconds, setShotDurationSeconds] = useState<number | null>(5);
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

    const addProductImages = async (files: File[]) => {
        if (!files.length) return;
        setUploading(true);
        try {
            const result = await uploadWorkspaceAssetFiles(files, "");
            if (result.addedAssetIds.length) setProductAssetIds((current) => [...new Set([...current, ...result.addedAssetIds])]);
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
        const resolvedShotDuration = Number(shotDurationSeconds) || 0;
        const resolvedTextModel = textModel || effectiveConfig.textModel;
        const resolvedImageModel = imageModel || effectiveConfig.imageModel;
        const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
        if (!sourceText) return message.warning("请先填写视频想法");
        if (resolvedScriptCount < 1 || resolvedScriptCount > 10) return message.warning("剧本数量需要在 1–10 条之间");
        if (resolvedShotCount < 1 || resolvedShotCount > 200) return message.warning("每条视频的分镜数量需要在 1–200 之间");
        if (resolvedShotDuration <= 0 || resolvedShotDuration > 60) return message.warning("单镜时长需要在 1–60 秒之间");
        if (!resolvedTextModel || !resolvedImageModel || !resolvedVideoModel) return message.warning("请先选择文本、图片和视频模型");
        if ([resolvedTextModel, resolvedImageModel, resolvedVideoModel].some((model) => !isAiConfigReady(effectiveConfig, model))) {
            return message.warning("所选模型当前不可用，请先检查模型配置");
        }
        setGenerating(true);
        setStatus("正在创建多剧本批次…");
        let batchId = "";
        try {
            const created = await createSmartFilmBatch({
                title: sourceText.slice(0, 24) || "多剧本智能成片",
                sourceText,
                inputAssetIds: productAssetIds,
                config: {
                    aspectRatio: "9:16",
                    defaultTextModel: resolvedTextModel,
                    defaultImageModel: resolvedImageModel,
                    defaultVideoModel: resolvedVideoModel,
                    scriptCount: resolvedScriptCount,
                    shotCount: resolvedShotCount,
                    shotDurationSeconds: resolvedShotDuration,
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
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple hidden onChange={(event) => void addProductImages(Array.from(event.target.files || []))} />
                </section>

                <section className="smart-film-batch-section">
                    <div className="smart-film-batch-section-title"><span>02</span><div><strong>剧本与规格</strong><small>每条剧本都会创建独立视频项目</small></div></div>
                    <div className="smart-film-batch-number-grid">
                        <label><span>生成剧本数量</span><InputNumber min={1} max={10} precision={0} value={scriptCount} onChange={setScriptCount} addonAfter="条" /></label>
                        <label><span>每条视频分镜数</span><InputNumber min={1} max={200} precision={0} value={shotCount} onChange={setShotCount} addonAfter="镜" /></label>
                        <label><span>单镜默认时长</span><InputNumber min={1} max={60} precision={1} value={shotDurationSeconds} onChange={setShotDurationSeconds} addonAfter="秒" /></label>
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
        </WorkspacePage>
    );
}
