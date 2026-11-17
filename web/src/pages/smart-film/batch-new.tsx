import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Progress, Select } from "antd";
import { ArrowLeft, ImagePlus, Library, LoaderCircle, Palette, Sparkles, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";

import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasStylePickerModal, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { ASSET_CATEGORY_LABELS, normalizeAssetCategory, type AssetCategory } from "@/lib/asset-category";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import type { SmartFilmScriptReference } from "@/lib/canvas/smart-film-scripts";
import { characterReferenceDisplayName, needsPlatformDefaultSkillConfirmation, SMART_FILM_LAST_SKILL_STORAGE_KEY } from "@/lib/canvas/smart-film-reference-defaults";
import { uploadWorkspaceAssetFiles } from "@/services/workspace-asset-upload";
import { createSmartFilmBatch, saveSmartFilmBatchScripts, type SmartFilmReferenceRole, type SmartFilmSkillSnapshot } from "@/services/api/smart-film-batches";
import { backendProviderConfig } from "@/services/api/generation-task";
import type { Skill } from "@/services/api/skills";
import { useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { createSmartFilmSkillSnapshot } from "@/services/smart-film-skill";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { logicalModelIDForConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { generateSmartFilmScripts } from "./smart-film-script-generation";

import "./smart-film.css";
import "./smart-film-batch.css";

const MAX_BATCH_PRODUCT_IMAGES = 12;
type BatchReferenceRole = Exclude<SmartFilmReferenceRole, "other">;
const REFERENCE_ROLE_OPTIONS: Array<{ value: BatchReferenceRole; label: string; category: AssetCategory }> = [
    { value: "product", label: "产品", category: "prop" },
    { value: "scene", label: "场景", category: "environment" },
    { value: "character", label: "人物", category: "character" },
    { value: "prop", label: "道具", category: "prop" },
];

export default function SmartFilmBatchNewPage() {
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const assets = useAssetStore((state) => state.assets);
    const { skills: installedSkills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingUploadRoleRef = useRef<BatchReferenceRole>("product");
    const [idea, setIdea] = useState("");
    const [productAssetIds, setProductAssetIds] = useState<string[]>([]);
    const [referenceRoles, setReferenceRoles] = useState<Record<string, BatchReferenceRole>>({});
    const [referenceNames, setReferenceNames] = useState<Record<string, string>>({});
    const [selectedSkillId, setSelectedSkillId] = useState(() => {
        if (typeof window === "undefined") return "";
        try {
            return window.localStorage.getItem(SMART_FILM_LAST_SKILL_STORAGE_KEY) || "";
        } catch {
            return "";
        }
    });
    const [scriptCount, setScriptCount] = useState<number | null>(3);
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [pickerRole, setPickerRole] = useState<BatchReferenceRole>("product");
    const [textModel, setTextModel] = useState("");
    const [imageModel, setImageModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [uploadingRole, setUploadingRole] = useState<BatchReferenceRole | null>(null);
    const [generating, setGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState(0);
    const [status, setStatus] = useState("");
    useEffect(() => {
        if (!generating) return;
        const timer = window.setInterval(() => setGenerationProgress((progress) => Math.min(90, progress + 1)), 1500);
        return () => window.clearInterval(timer);
    }, [generating]);
    const productAssets = productAssetIds.flatMap((id) => {
        const asset = assets.find((item) => item.id === id && item.kind === "image");
        return asset ? [asset as ImageAsset] : [];
    });
    const referenceAssetsByRole = Object.fromEntries(REFERENCE_ROLE_OPTIONS.map((option) => [
        option.value,
        productAssets.filter((asset) => (referenceRoles[asset.id] || "prop") === option.value),
    ])) as Record<BatchReferenceRole, ImageAsset[]>;
    const selectedSkill = useMemo<Skill | undefined>(() => installedSkills.find((skill) => skill.skillId === selectedSkillId), [installedSkills, selectedSkillId]);
    useEffect(() => {
        if (skillsLoading || !selectedSkillId) return;
        if (installedSkills.some((skill) => skill.skillId === selectedSkillId)) return;
        setSelectedSkillId("");
    }, [installedSkills, selectedSkillId, skillsLoading]);
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

    const addProductImages = async (role: BatchReferenceRole, files: File[]) => {
        if (!files.length) return;
        const remaining = MAX_BATCH_PRODUCT_IMAGES - productAssetIds.length;
        if (remaining <= 0) {
            message.warning(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
            return;
        }
        const accepted = files.slice(0, remaining);
        if (accepted.length < files.length) message.warning(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张，已忽略超出部分`);
        setUploadingRole(role);
        try {
            const category = REFERENCE_ROLE_OPTIONS.find((option) => option.value === role)?.category || "prop";
            const result = await uploadWorkspaceAssetFiles(accepted, "", { category });
            if (result.addedAssetIds.length) {
                setProductAssetIds((current) => [...new Set([...current, ...result.addedAssetIds])].slice(0, MAX_BATCH_PRODUCT_IMAGES));
                setReferenceRoles((current) => ({ ...current, ...Object.fromEntries(result.addedAssetIds.map((id) => [id, role])) }));
            }
            if (result.failed) message.warning(`${result.failed} 张参考图上传失败`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "参考图上传失败");
        } finally {
            setUploadingRole(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const createBatch = async () => {
        const sourceText = idea.trim();
        const resolvedScriptCount = Number(scriptCount) || 0;
        if (skillsLoading) return message.warning("正在读取技能库，请稍候再生成剧本");
        const resolvedTextModel = textModel || effectiveConfig.textModel;
        const resolvedImageModel = imageModel || effectiveConfig.imageModel;
        const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
        if (!sourceText) return message.warning("请先填写视频想法");
        if (resolvedScriptCount < 1 || resolvedScriptCount > 10) return message.warning("剧本数量需要在 1–10 条之间");
        if (productAssetIds.length > MAX_BATCH_PRODUCT_IMAGES) return message.warning(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
        const characterAssets = productAssets.filter((asset) => referenceRoles[asset.id] === "character");
        const inputAssetNames = Object.fromEntries(characterAssets.map((asset, index) => [
            asset.id,
            (referenceNames[asset.id] || characterReferenceDisplayName(asset.title, index)).trim(),
        ]));
        if (characterAssets.some((asset) => !inputAssetNames[asset.id])) return message.warning("请为每个人物参考图填写人物名称");
        if (!resolvedTextModel || !resolvedImageModel || !resolvedVideoModel) return message.warning("请先选择文本、图片和视频模型");
        if ([resolvedTextModel, resolvedImageModel, resolvedVideoModel].some((model) => !isAiConfigReady(effectiveConfig, model))) {
            return message.warning("所选模型当前不可用，请先检查模型配置");
        }
        if (needsPlatformDefaultSkillConfirmation(installedSkills.length, selectedSkillId)) {
            const usePlatformDefault = await new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "本批次未选择制作 Skill",
                    content: "继续后将使用平台默认规则，不会加载你已经安装的 Skill。角色、资产、分镜和视频阶段都会使用平台规则。",
                    okText: "使用平台默认",
                    cancelText: "返回选择 Skill",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
            if (!usePlatformDefault) return;
        }
        setGenerating(true);
        setGenerationProgress(5);
        setStatus("正在创建多剧本批次…");
        let batchId = "";
        try {
            let skillSnapshot: SmartFilmSkillSnapshot | undefined;
            if (selectedSkill) {
                setStatus("正在读取所选技能的阶段规范…");
                skillSnapshot = await createSmartFilmSkillSnapshot(selectedSkill, installedSkills);
            }
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
                    inputAssetNames,
                    ...(skillSnapshot ? { skillSnapshot } : {}),
                    scriptCount: resolvedScriptCount,
                },
                budgetPoints: 0,
                orchestrationConfig: {
                    text: textProvider,
                    image: imageProvider,
                    video: videoProvider,
                },
            });
            batchId = created.batch.id;
            setGenerationProgress(10);
            setStatus(`正在生成 ${resolvedScriptCount} 条独立剧本…`);
            const generated = await generateSmartFilmScripts({
                idea: sourceText,
                references: productAssets.map((asset) => ({
                    title: inputAssetNames[asset.id] || asset.title,
                    role: referenceRoles[asset.id] || "prop",
                })) satisfies SmartFilmScriptReference[],
                count: resolvedScriptCount,
                config: { ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel, imageModel: resolvedImageModel, videoModel: resolvedVideoModel },
                batchId,
                skillSnapshot,
                onProgress: (progress, stage) => {
                    setGenerationProgress(Math.max(10, progress));
                    if (stage) setStatus(stage);
                },
            });
            setGenerationProgress(95);
            setStatus("正在保存剧本候选…");
            await saveSmartFilmBatchScripts(
                batchId,
                generated.scripts.map((script) => ({ title: script.title, content: script.content, taskId: generated.taskId })),
                created.batch.revision,
            );
            setGenerationProgress(100);
            navigate(`/smart-film/batches/${batchId}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "多剧本生成失败，请重试");
            if (batchId) navigate(`/smart-film/batches/${batchId}`);
        } finally {
            setGenerating(false);
            if (!batchId) setGenerationProgress(0);
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
                    <div className="smart-film-batch-section-title"><span>01</span><div><strong>想法与参考素材</strong><small>可上传产品、场景、人物、道具等参考图；创建项目后会分析剧本所需资产并生成可修改的提示词</small></div></div>
                    <Input.TextArea value={idea} onChange={(event) => setIdea(event.target.value)} autoSize={{ minRows: 5, maxRows: 10 }} placeholder="例如：为这款便携咖啡机做 3 条不同角度的独立短视频，分别突出办公室、露营和早晨通勤。" />
                    <div className="smart-film-reference-groups">
                        {REFERENCE_ROLE_OPTIONS.map((option) => {
                            const roleAssets = referenceAssetsByRole[option.value] || [];
                            const uploading = uploadingRole === option.value;
                            return (
                                <section className="smart-film-reference-group" key={option.value}>
                                    <header>
                                        <div><strong>{option.label}</strong><small>{roleAssets.length ? `已添加 ${roleAssets.length} 张` : "可选，不添加也可以继续"}</small></div>
                                        <div className="smart-film-reference-group-actions">
                                            <button type="button" disabled={Boolean(uploadingRole) || generating} onClick={() => { pendingUploadRoleRef.current = option.value; fileInputRef.current?.click(); }}>
                                                {uploading ? <LoaderCircle className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                                                {uploading ? "正在上传" : `添加${option.label}`}
                                            </button>
                                            <button type="button" disabled={generating} onClick={() => { setPickerRole(option.value); setAssetPickerOpen(true); }}>
                                                <Library className="size-3.5" />素材库
                                            </button>
                                        </div>
                                    </header>
                                    <div className="smart-film-product-grid">
                                        {roleAssets.map((asset, index) => (
                                            <div className="smart-film-product-card" key={asset.id}>
                                                <CachedResourceImage storageKey={asset.data.storageKey} src={asset.data.dataUrl} alt={asset.title} eager />
                                                {option.value === "character" ? (
                                                    <Input
                                                        size="small"
                                                        className="smart-film-character-name"
                                                        maxLength={80}
                                                        value={referenceNames[asset.id] ?? characterReferenceDisplayName(asset.title, index)}
                                                        placeholder="填写人物名称"
                                                        aria-label={`${asset.title} 的人物名称`}
                                                        onChange={(event) => setReferenceNames((current) => ({ ...current, [asset.id]: event.target.value }))}
                                                    />
                                                ) : <span title={asset.title}>{asset.title}</span>}
                                                <button type="button" aria-label={`移除 ${asset.title}`} onClick={() => { setProductAssetIds((current) => current.filter((id) => id !== asset.id)); setReferenceRoles((current) => { const next = { ...current }; delete next[asset.id]; return next; }); setReferenceNames((current) => { const next = { ...current }; delete next[asset.id]; return next; }); }}><Trash2 className="size-3.5" /></button>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                    <small className="smart-film-product-hint">参考图合计最多 {MAX_BATCH_PRODUCT_IMAGES} 张。人物图会自动使用素材名；素材名为“生成图片”时会依次命名为“角色 1、角色 2”，你可以直接使用或修改。</small>
                    <div className="smart-film-skill-select-row">
                        <div>
                            <strong>制作技能</strong>
                            <span>{selectedSkillId ? "批次会固定这组 Skill；已安装的同套件导演、分镜、全链路和剪辑 Skill 会自动组合。" : installedSkills.length ? "当前未选择 Skill；继续制作前会再次确认使用平台默认规则。" : "没有安装 Skill 时使用平台默认规则。"}</span>
                        </div>
                        <div className="smart-film-skill-select-actions">
                            <Select
                                allowClear
                                showSearch
                                value={selectedSkillId || undefined}
                                loading={skillsLoading}
                                disabled={generating}
                                optionFilterProp="label"
                                placeholder="选择一个已安装技能（可选）"
                                options={installedSkills.map((skill) => ({ value: skill.skillId, label: `${skill.skillName} · ${skill.version}` }))}
                                onChange={(value) => {
                                    const next = value || "";
                                    setSelectedSkillId(next);
                                    try {
                                        window.localStorage.setItem(SMART_FILM_LAST_SKILL_STORAGE_KEY, next);
                                    } catch {
                                        // 浏览器禁用本地存储时只保留当前页面选择。
                                    }
                                }}
                                notFoundContent={skillsLoading ? "正在读取技能库" : "还没有已安装技能"}
                                aria-label="本批次使用的单一技能"
                            />
                            <Button size="small" disabled={generating} onClick={() => navigate("/skills")}>管理技能</Button>
                        </div>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple hidden onChange={(event) => void addProductImages(pendingUploadRoleRef.current, Array.from(event.target.files || []))} />
                </section>

                <section className="smart-film-batch-section">
                    <div className="smart-film-batch-section-title"><span>02</span><div><strong>剧本与画面规格</strong><small>先确定剧本数量和统一画幅、画风；分镜策略将在剧本确认后设置</small></div></div>
                    <div className="smart-film-batch-number-grid">
                        <label><span>生成剧本数量</span><InputNumber min={1} max={10} precision={0} value={scriptCount} onChange={setScriptCount} addonAfter="条" /></label>
                        <label><span>成片画幅</span><Select value={aspectRatio} onChange={setAspectRatio} disabled={generating} options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} /></label>
                    </div>
                    <div className="smart-film-batch-style-row">
                        <div>
                            <strong>项目画风</strong>
                            <span>{selectedStyle ? `${selectedStyle.title}，将应用到角色、场景、分镜图和镜头视频提示词` : "未指定时使用模型默认风格；可选择后统一全批次视觉基线"}</span>
                        </div>
                        <Button size="small" icon={<Palette className="size-3.5" />} disabled={generating} onClick={() => setStylePickerOpen(true)}>
                            {selectedStyle ? `画风：${selectedStyle.title}` : "选择/新建画风（可选）"}
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
                    <div className="smart-film-batch-submit-copy">
                        <strong>确认后生成独立剧本候选</strong>
                        <span>每条剧本都可以单独重新生成、修改和选择是否制作。</span>
                        {generating ? <div className="smart-film-generation-progress"><Progress percent={generationProgress} size="small" /><small>{status || "正在生成剧本候选"}</small></div> : null}
                    </div>
                    <Button type="primary" size="large" loading={generating || Boolean(uploadingRole) || skillsLoading} icon={<Sparkles className="size-4" />} onClick={() => void createBatch()}>
                        {generating ? `${generationProgress}%` : skillsLoading ? "正在读取技能库" : `生成 ${scriptCount || 0} 条剧本`}
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
                initialSelectedIds={productAssetIds.filter((id) => referenceRoles[id] === pickerRole)}
                multiple
                eyebrow="参考素材"
                title={`选择${REFERENCE_ROLE_OPTIONS.find((option) => option.value === pickerRole)?.label || "参考"}图`}
                confirmLabel={(count) => `使用已选${count ? ` ${count} 张` : "图片"}`}
                emptyTitle="素材库还没有可用图片"
                emptyDescription="先上传参考图，或返回素材库整理图片后重试。"
                footerNote={`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张，只会使用当前账号拥有的图片。`}
                onClose={() => setAssetPickerOpen(false)}
                onConfirm={async (ids) => {
                    if (ids.length > MAX_BATCH_PRODUCT_IMAGES) throw new Error(`参考图最多 ${MAX_BATCH_PRODUCT_IMAGES} 张`);
                    const otherRoleIds = productAssetIds.filter((id) => referenceRoles[id] !== pickerRole);
                    const nextIds = [...new Set([...otherRoleIds, ...ids])].slice(0, MAX_BATCH_PRODUCT_IMAGES);
                    setProductAssetIds(nextIds);
                    setReferenceRoles((current) => {
                        const selected = new Set(ids);
                        const next: Record<string, BatchReferenceRole> = {};
                        nextIds.forEach((id) => { next[id] = selected.has(id) ? pickerRole : current[id] || "prop"; });
                        return next;
                    });
                    setAssetPickerOpen(false);
                }}
            />
        </WorkspacePage>
    );
}
