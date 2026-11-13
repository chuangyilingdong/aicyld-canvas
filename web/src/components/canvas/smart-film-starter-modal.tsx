import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, Modal, Select, Switch } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { Palette, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import { CanvasStylePickerModal, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { isMusicAudioModel } from "@/lib/audio-generation";
import { canvasFeatureModel } from "@/lib/canvas/feature-models";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { settingsPath } from "@/lib/settings-navigation";
import {
    createProject,
    createProjectUnit,
    createUnitWorkflow,
    getProjectCore,
    replaceProjectUnitShots,
} from "@/services/api/projects";
import { modelDisplayName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { storyboardRowsToProjectShots } from "@/pages/projects/detail/chapter-storyboard-production";
import { extractChapterAssets, generateChapterStoryboard } from "@/pages/projects/detail/project-chapter-ai";

type Props = {
    open: boolean;
    initialTopic?: string;
    onClose: () => void;
};

type NewProjectInput = Omit<Parameters<typeof createProject>[0], "name">;

export function SmartFilmStarterModal({ open, initialTopic = "", onClose }: Props) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [topic, setTopic] = useState("");
    const [shotCount, setShotCount] = useState("6");
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [textModel, setTextModel] = useState("");
    const [imageModel, setImageModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [autoRun, setAutoRun] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [status, setStatus] = useState("");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const musicModel = useMemo(
        () => canvasFeatureModel("audio.music") || (effectiveConfig.audioModels || []).find(isMusicAudioModel) || "",
        [effectiveConfig],
    );

    useEffect(() => {
        if (!open) return;
        setTopic(initialTopic.trim());
        setTextModel(effectiveConfig.textModel || "");
        setImageModel(effectiveConfig.imageModel || "");
        setVideoModel(effectiveConfig.videoModel || "");
        setAutoRun(true);
    }, [effectiveConfig.imageModel, effectiveConfig.textModel, effectiveConfig.videoModel, initialTopic, open]);

    const requestClose = () => {
        if (!generating) onClose();
    };

    const createSmartFilm = async () => {
        const cleanTopic = topic.trim();
        const resolvedTextModel = textModel || effectiveConfig.textModel;
        const resolvedImageModel = imageModel || effectiveConfig.imageModel;
        const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
        if (!cleanTopic || generating) return;
        if (!resolvedTextModel || !resolvedImageModel || !resolvedVideoModel) {
            modal.warning({
                title: "请先选择完整模型",
                content: "智能成片需要分别选择文本、图片和视频模型。",
                okText: "去配置",
                cancelText: "取消",
                onOk: () => navigate(settingsPath("models")),
            });
            return;
        }
        const unavailable = [
            ["文本", resolvedTextModel],
            ["图片", resolvedImageModel],
            ["视频", resolvedVideoModel],
        ].filter(([, model]) => !isAiConfigReady(effectiveConfig, model));
        if (unavailable.length) {
            modal.warning({
                title: "所选模型当前不可用",
                content: `请检查 ${unavailable.map(([label]) => label).join("、")}模型的渠道配置后重试。`,
                okText: "去设置",
                cancelText: "取消",
                onOk: () => navigate(settingsPath("models")),
            });
            return;
        }

        setGenerating(true);
        setStatus("正在创建项目…");
        try {
            const project = await createUniqueProject(cleanTopic, {
                type: autoRun ? "smart-film-auto" : "smart-film",
                aspectRatio,
                sourceType: "text",
                description: cleanTopic,
                defaultImageModel: resolvedImageModel,
                defaultVideoModel: resolvedVideoModel,
                ...(selectedStyle ? {
                    stylePresetId: selectedStyle.id,
                    styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)),
                } : {}),
            });
            setStatus("正在创建章节与制作流程…");
            const { unit } = await createProjectUnit(project.project.id, {
                kind: "chapter",
                title: project.project.name,
                sourceText: cleanTopic,
                position: 0,
            });
            await createUnitWorkflow(project.project.id, unit.id);
            const core = await getProjectCore(project.project.id);
            let characters: Array<{ name: string; definition: Record<string, unknown> }> = [];
            let assets: Array<{ id: string; title: string; type: "image"; category: string; tags: string[]; prompt: string }> = [];
            try {
                setStatus("正在提取角色、场景和道具…");
                const extracted = await extractChapterAssets({
                    projectId: project.project.id,
                    projectName: project.project.name,
                    chapterId: unit.id,
                    chapterTitle: unit.title,
                    sourceText: cleanTopic,
                    projectStyle: selectedStyle?.prompt || "",
                    config: { ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel, imageModel: resolvedImageModel, videoModel: resolvedVideoModel },
                });
                characters = extracted.characters.map((character) => ({ name: character.name, definition: { ...character } }));
                assets = [
                    ...extracted.scenes.map((scene, index) => ({ id: `smart-scene-${index}`, title: scene.name, type: "image" as const, category: "environment", tags: [], prompt: scene.prompt })),
                    ...extracted.props.map((prop, index) => ({ id: `smart-prop-${index}`, title: prop.name, type: "image" as const, category: "prop", tags: [], prompt: prop.prompt })),
                ];
            } catch {
                message.warning("角色、场景和道具提取失败，继续生成分镜");
            }
            setStatus(`正在规划 ${shotCount} 个镜头…`);
            const generated = await generateChapterStoryboard({
                projectId: project.project.id,
                chapterId: unit.id,
                chapterTitle: unit.title,
                sourceText: cleanTopic,
                projectStyle: selectedStyle ? {
                    presetId: selectedStyle.id,
                    title: selectedStyle.title,
                    prompt: selectedStyle.prompt,
                    profileJson: selectedStyle.profile ? serializeStyleProfile(selectedStyle.profile) : undefined,
                } : { presetId: "", title: "", prompt: "" },
                characters,
                assets,
                config: { ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel, imageModel: resolvedImageModel, videoModel: resolvedVideoModel },
                skills: [],
                selectedSkillIds: [],
                approvedRevision: core.project.revision,
                approvedShotIds: [],
                shotCount: Number(shotCount),
                userRequirements: `这是一条从主题直接启动的成片项目。主题：${cleanTopic}\n画面以 AI 生成图片和视频为主，分镜要能直接继续生成首帧和镜头视频。`,
            });
            if (!generated.rows.length) throw new Error("模型没有返回有效分镜，请重试");
            setStatus("正在写入分镜…");
            const shots = storyboardRowsToProjectShots(generated.rows);
            await replaceProjectUnitShots(project.project.id, unit.id, shots, [], core.project.revision, { sourceTaskId: generated.taskId });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["projects"] }),
                queryClient.invalidateQueries({ queryKey: ["canvas-projects"] }),
                queryClient.invalidateQueries({ queryKey: ["project", project.project.id] }),
            ]);
            onClose();
            message.success(autoRun ? `已生成 ${shots.length} 个分镜，开始自动制作成片` : `已生成 ${shots.length} 个分镜，图片与视频模型已写入项目默认配置`);
            navigate(`/projects/${project.project.id}/workflow/${unit.id}/storyboard${autoRun ? "?autostart=1" : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "智能成片创建失败，请重试");
        } finally {
            setGenerating(false);
            setStatus("");
        }
    };

    return (
        <>
            <Modal
                title="智能成片"
                open={open}
                footer={null}
                width={820}
                closable={!generating}
                mask={{ closable: false }}
                keyboard={!generating}
                onCancel={requestClose}
            >
                <div className="space-y-4 pt-2">
                    <label className="block space-y-1.5">
                        <span className="block text-xs font-medium text-foreground/60">视频主题或文案</span>
                        <Input.TextArea
                            id="smart-film-topic"
                            value={topic}
                            onChange={(event) => setTopic(event.target.value)}
                            autoSize={{ minRows: 3, maxRows: 6 }}
                            maxLength={2000}
                            showCount
                            disabled={generating}
                            placeholder="例如：为什么冬天更容易静电？用 4 个镜头做一个通俗科普短视频。"
                        />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5 text-xs font-medium text-foreground/60">
                            <span>分镜数量</span>
                            <Select className="w-full" value={shotCount} onChange={setShotCount} disabled={generating} options={[{ label: "4 镜 · 快速样片", value: "4" }, { label: "6 镜 · 标准短视频", value: "6" }, { label: "8 镜 · 更完整叙事", value: "8" }, { label: "10 镜 · 深度内容", value: "10" }]} />
                        </label>
                        <label className="space-y-1.5 text-xs font-medium text-foreground/60">
                            <span>成片画幅</span>
                            <Select className="w-full" value={aspectRatio} onChange={setAspectRatio} disabled={generating} options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} />
                        </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5"><span className="block text-xs font-medium text-foreground/60">文本模型</span><ModelPicker config={effectiveConfig} value={textModel || effectiveConfig.textModel} onChange={setTextModel} capability="text" fullWidth variant="creation" placeholder="选择文本模型" onMissingConfig={() => navigate(settingsPath("models"))} /></div>
                        <div className="space-y-1.5"><span className="block text-xs font-medium text-foreground/60">图片模型</span><ModelPicker config={effectiveConfig} value={imageModel || effectiveConfig.imageModel} onChange={setImageModel} capability="image" fullWidth variant="creation" placeholder="选择图片模型" onMissingConfig={() => navigate(settingsPath("models"))} /></div>
                        <div className="space-y-1.5"><span className="block text-xs font-medium text-foreground/60">视频模型</span><ModelPicker config={effectiveConfig} value={videoModel || effectiveConfig.videoModel} onChange={setVideoModel} capability="video" fullWidth variant="creation" placeholder="选择视频模型" onMissingConfig={() => navigate(settingsPath("models"))} /></div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-4 py-3">
                        <span className="text-xs text-foreground/50">画风用于统一角色、场景与画面质感</span>
                        <Button size="small" icon={<Palette className="size-3.5" />} disabled={generating} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? `画风：${selectedStyle.title}` : "选择画风（可选）"}</Button>
                    </div>
                    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 px-4 py-3">
                        <div>
                            <div className="text-sm font-medium">全自动制作成片</div>
                            <p className="mt-1 text-xs leading-5 text-foreground/48">生成分镜后继续补齐分镜图和镜头视频，有台词镜头使用平台 TTS 模型生成旁白，并使用音乐功能模型生成 BGM，全部完成后自动提交一键成片。会连续产生多次生成任务和积分消耗。</p>
                            <p className="mt-1 text-xs leading-5 text-foreground/40">{musicModel ? `BGM 模型：${modelDisplayName(effectiveConfig, musicModel)}` : "未配置 audio.music 模型，自动成片将跳过 BGM。"}</p>
                        </div>
                        <Switch checked={autoRun} onChange={setAutoRun} disabled={generating} aria-label="全自动制作成片" />
                    </div>
                    <div className="rounded-xl bg-[color-mix(in_srgb,var(--workspace-accent)_7%,transparent)] px-4 py-3 text-xs leading-6 text-foreground/60">
                        {autoRun ? "主题 → 分镜 → 全部分镜图 → 全部镜头视频 → 旁白 + BGM → MP4/SRT 成片。执行期间请保持页面打开。" : "主题 → 分镜。图片和视频可在分镜工作台继续手动生成。"}图片和视频生成使用上方选择的模型，旁白与 BGM 使用平台音频功能模型。费用按实际任务账单结算。
                    </div>
                    {status ? <p className="text-xs text-foreground/55" role="status">{status}</p> : null}
                    <div className="flex justify-end gap-2">
                        <Button disabled={generating} onClick={requestClose}>取消</Button>
                        <Button type="primary" icon={<Sparkles className="size-3.5" />} loading={generating} disabled={!topic.trim()} onClick={() => void createSmartFilm()}>{generating ? "正在准备分镜" : autoRun ? "创建并自动成片" : "创建并生成分镜"}</Button>
                    </div>
                </div>
            </Modal>
            <CanvasStylePickerModal open={stylePickerOpen} value={selectedStyle?.id || ""} onClose={() => setStylePickerOpen(false)} onSelect={(preset) => { setSelectedStyle(preset); setStylePickerOpen(false); }} />
        </>
    );
}

async function createUniqueProject(sourceText: string, input: NewProjectInput) {
    const base = sourceText.trim().slice(0, 24) || "未命名项目";
    let attempt = 0;
    for (;;) {
        try {
            return await createProject({ ...input, name: attempt === 0 ? base : `${base}（${attempt + 1}）` });
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const uniqueConflict = message.includes("UNIQUE") || message.includes("projects.user_id") || message.includes("projects.name");
            if (!uniqueConflict || attempt >= 5) throw error;
            attempt += 1;
        }
    }
}
