import { useEffect, useMemo, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Select, Switch } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Palette, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import { CanvasStylePickerModal, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { isMusicAudioModel } from "@/lib/audio-generation";
import { canvasFeatureModel } from "@/lib/canvas/feature-models";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { createStyleProfileSnapshot, serializeStyleProfile } from "@/lib/canvas/style-profile";
import {
    isValidSmartFilmShotCount,
    normalizeSmartFilmShotCount,
    normalizeSmartFilmShotSeconds,
    resizeSmartFilmShotDurations,
    SMART_FILM_DEFAULT_SHOT_COUNT,
    SMART_FILM_MAX_SHOT_COUNT,
    SMART_FILM_MIN_SHOT_COUNT,
    smartFilmDefaultShotSeconds,
    smartFilmDurationOptions,
    smartFilmMaxClipSeconds,
} from "@/lib/canvas/smart-film-options";
import { settingsPath } from "@/lib/settings-navigation";
import { createProject, createProjectAssetCandidates, createProjectUnit, createUnitWorkflow, getProjectCore, replaceProjectUnitShots, updateProject } from "@/services/api/projects";
import { modelDisplayName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { storyboardRowsToProjectShots } from "@/pages/projects/detail/chapter-storyboard-production";
import { extractChapterAssets, generateChapterStoryboard } from "@/pages/projects/detail/project-chapter-ai";

type Props = {
    open?: boolean;
    initialTopic?: string;
    onClose: () => void;
    presentation?: "modal" | "page";
};

type NewProjectInput = Omit<Parameters<typeof createProject>[0], "name">;

export function SmartFilmStarter({ open = true, initialTopic = "", onClose, presentation = "modal" }: Props) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [topic, setTopic] = useState("");
    const [shotCount, setShotCount] = useState<number | null>(SMART_FILM_DEFAULT_SHOT_COUNT);
    const [shotDurations, setShotDurations] = useState<number[]>([]);
    const [aspectRatio, setAspectRatio] = useState("9:16");
    const [textModel, setTextModel] = useState("");
    const [imageModel, setImageModel] = useState("");
    const [videoModel, setVideoModel] = useState("");
    const [autoRun, setAutoRun] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [status, setStatus] = useState("");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [createdProject, setCreatedProject] = useState<{ id: string; name: string; unitId?: string } | null>(null);
    const musicModel = useMemo(() => canvasFeatureModel("audio.music") || (effectiveConfig.audioModels || []).find(isMusicAudioModel) || "", [effectiveConfig]);
    const resolvedVideoModel = videoModel || effectiveConfig.videoModel;
    const videoProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, resolvedVideoModel).video, [effectiveConfig, resolvedVideoModel]);
    const durationOptions = useMemo(() => smartFilmDurationOptions(videoProfile), [videoProfile]);
    const maxClipSeconds = smartFilmMaxClipSeconds(videoProfile);
    const defaultShotSeconds = smartFilmDefaultShotSeconds(videoProfile);
    const normalizedShotCount = normalizeSmartFilmShotCount(shotCount);
    const shotCountValid = isValidSmartFilmShotCount(shotCount);
    const totalDurationSeconds = shotDurations.reduce((total, value) => total + value, 0);

    useEffect(() => {
        if (!open) return;
        setTopic(initialTopic.trim());
        setTextModel(effectiveConfig.textModel || "");
        setImageModel(effectiveConfig.imageModel || "");
        setVideoModel(effectiveConfig.videoModel || "");
        setAutoRun(false);
        setCreatedProject(null);
    }, [effectiveConfig.imageModel, effectiveConfig.textModel, effectiveConfig.videoModel, initialTopic, open]);

    useEffect(() => {
        if (!open || !shotCountValid) return;
        setShotDurations((previous) => resizeSmartFilmShotDurations(previous, normalizedShotCount, videoProfile));
    }, [open, normalizedShotCount, shotCountValid, videoProfile]);

    const requestClose = () => {
        if (!generating) onClose();
    };

    const updateShotDuration = (index: number, value: unknown) => {
        setShotDurations((previous) => previous.map((duration, current) => (current === index ? normalizeSmartFilmShotSeconds(value, videoProfile) : duration)));
    };

    const createSmartFilm = async () => {
        const cleanTopic = topic.trim();
        const resolvedTextModel = textModel || effectiveConfig.textModel;
        const resolvedImageModel = imageModel || effectiveConfig.imageModel;
        if (!cleanTopic || generating) return;
        if (!shotCountValid) {
            modal.warning({ title: "分镜数量无效", content: `请输入 ${SMART_FILM_MIN_SHOT_COUNT}–${SMART_FILM_MAX_SHOT_COUNT} 之间的整数。`, okText: "知道了" });
            return;
        }
        const resolvedShotCount = normalizeSmartFilmShotCount(shotCount);
        const resolvedShotDurations = resizeSmartFilmShotDurations(shotDurations, resolvedShotCount, videoProfile);
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
        if (!resolvedShotDurations.length || resolvedShotDurations.some((duration) => duration <= 0 || duration > maxClipSeconds)) {
            modal.warning({ title: "单镜时长无效", content: `每个镜头必须在 1–${maxClipSeconds} 秒内。`, okText: "知道了" });
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
                ...(selectedStyle
                    ? {
                          stylePresetId: selectedStyle.id,
                          styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)),
                      }
                    : {}),
            });
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            await updateProject(project.project.id, {
                defaultImageModel: resolvedImageModel,
                defaultVideoModel: resolvedVideoModel,
                ...(selectedStyle
                    ? {
                          stylePresetId: selectedStyle.id,
                          styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)),
                      }
                    : {}),
            });
            setCreatedProject({ id: project.project.id, name: project.project.name });
            setStatus("项目已创建，正在准备章节与制作流程…");
            const { unit } = await createProjectUnit(project.project.id, {
                kind: "chapter",
                title: project.project.name,
                sourceText: cleanTopic,
                position: 0,
            });
            setCreatedProject({ id: project.project.id, name: project.project.name, unitId: unit.id });
            await createUnitWorkflow(project.project.id, unit.id);
            const core = await getProjectCore(project.project.id);
            let approvedRevision = core.project.revision;
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
                const candidates = [
                    ...extracted.characters.map((asset) => ({ unitId: unit.id, name: asset.name, category: "character" as const, details: { ...asset } })),
                    ...extracted.scenes.map((asset) => ({ unitId: unit.id, name: asset.name, category: "environment" as const, details: { ...asset } })),
                    ...extracted.props.map((asset) => ({ unitId: unit.id, name: asset.name, category: "prop" as const, details: { ...asset } })),
                ];
                if (candidates.length) await createProjectAssetCandidates(project.project.id, candidates, "chapter_character_extract", { sourceTaskId: extracted.taskId });
            } catch {
                message.warning("角色、场景和道具提取失败，继续生成分镜");
            }
            approvedRevision = (await getProjectCore(project.project.id)).project.revision;
            setStatus(`正在规划 ${resolvedShotCount} 个镜头…`);
            const generated = await generateChapterStoryboard({
                projectId: project.project.id,
                chapterId: unit.id,
                chapterTitle: unit.title,
                sourceText: cleanTopic,
                projectStyle: selectedStyle
                    ? {
                          presetId: selectedStyle.id,
                          title: selectedStyle.title,
                          prompt: selectedStyle.prompt,
                          profileJson: selectedStyle.profile ? serializeStyleProfile(selectedStyle.profile) : undefined,
                      }
                    : { presetId: "", title: "", prompt: "" },
                characters,
                assets,
                config: { ...effectiveConfig, model: resolvedTextModel, textModel: resolvedTextModel, imageModel: resolvedImageModel, videoModel: resolvedVideoModel },
                skills: [],
                selectedSkillIds: [],
                approvedRevision,
                approvedShotIds: [],
                shotCount: resolvedShotCount,
                shotDurationsSeconds: resolvedShotDurations,
                userRequirements: [
                    `这是一条从主题直接启动的成片项目。主题：${cleanTopic}`,
                    `逐镜时长必须严格执行：${resolvedShotDurations.map((duration, index) => `第 ${index + 1} 镜 ${duration} 秒`).join("，")}。`,
                    `单个镜头不得超过 ${maxClipSeconds} 秒；如果某一镜内容放不下，请拆分叙事而不是超过模型上限。`,
                    "画面以 AI 生成图片和视频为主，分镜要能直接继续生成首帧和镜头视频。",
                ].join("\n"),
            });
            if (!generated.rows.length) throw new Error("模型没有返回有效分镜，请重试");
            const expectedShotCount = resolvedShotCount;
            if (generated.rows.length < expectedShotCount) {
                throw new Error(`模型只返回了 ${generated.rows.length} 个分镜，少于要求的 ${expectedShotCount} 个，请重试`);
            }
            setStatus("正在写入分镜…");
            const shots = storyboardRowsToProjectShots(generated.rows.slice(0, expectedShotCount)).map((shot, index) => {
                const duration = resolvedShotDurations[index] ?? defaultShotSeconds;
                const durationMs = Math.round(duration * 1000);
                return { ...shot, durationMs, revision: { ...shot.revision, durationMs } };
            });
            await replaceProjectUnitShots(project.project.id, unit.id, shots, [], approvedRevision, { sourceTaskId: generated.taskId });
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["projects"] }), queryClient.invalidateQueries({ queryKey: ["canvas-projects"] }), queryClient.invalidateQueries({ queryKey: ["project", project.project.id] })]);
            if (presentation === "modal") onClose();
            message.success(autoRun ? `已生成 ${shots.length} 个分镜，开始自动制作成片` : `已生成 ${shots.length} 个分镜，图片与视频模型已写入项目默认配置`);
            navigate(`/projects/${project.project.id}/workflow/${unit.id}/storyboard${autoRun ? "?autostart=1" : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "智能成片创建失败，请重试");
        } finally {
            setGenerating(false);
            setStatus("");
        }
    };

    const content = (
        <div className={presentation === "page" ? "smart-film-form" : "space-y-4 pt-2"}>
            {createdProject ? (
                <div className="smart-film-created" role="status">
                    <div>
                        <strong>项目已创建：{createdProject.name}</strong>
                        <span>即使关闭页面，也可以从项目库继续编辑。</span>
                    </div>
                    <Button size="small" icon={<Clapperboard className="size-3.5" />} onClick={() => navigate(createdProject.unitId ? `/projects/${createdProject.id}/workflow/${createdProject.unitId}/storyboard` : `/projects/${createdProject.id}`)}>
                        打开项目
                    </Button>
                </div>
            ) : null}
            <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-foreground/60">视频主题或文案</span>
                <Input.TextArea
                    id="smart-film-topic"
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    autoSize={{ minRows: 4, maxRows: 8 }}
                    maxLength={2000}
                    showCount
                    disabled={generating}
                    placeholder="例如：为什么冬天更容易静电？用 4 个镜头做一个通俗科普短视频。"
                />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium text-foreground/60">
                    <span>分镜数量</span>
                    <InputNumber className="w-full" value={shotCount} onChange={setShotCount} disabled={generating} min={SMART_FILM_MIN_SHOT_COUNT} max={SMART_FILM_MAX_SHOT_COUNT} step={1} precision={0} suffix="镜" aria-label="分镜数量" />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-foreground/60">
                    <span>成片画幅</span>
                    <Select
                        className="w-full"
                        value={aspectRatio}
                        onChange={setAspectRatio}
                        disabled={generating}
                        options={[
                            { label: "9:16 竖屏", value: "9:16" },
                            { label: "16:9 横屏", value: "16:9" },
                            { label: "1:1 方形", value: "1:1" },
                        ]}
                    />
                </label>
            </div>
            <section className="smart-film-duration-section">
                <div className="smart-film-duration-heading">
                    <div>
                        <strong>每个分镜时长</strong>
                        <span>
                            视频模型单镜上限：{maxClipSeconds} 秒 · 预计总时长 {totalDurationSeconds} 秒
                        </span>
                    </div>
                    <span className="smart-film-duration-hint">可逐镜调整，生成分镜时会严格按此写入</span>
                </div>
                <div className="smart-film-duration-grid">
                    {shotDurations.map((duration, index) => (
                        <label key={index}>
                            <span>镜头 {index + 1}</span>
                            <Select value={duration} onChange={(value) => updateShotDuration(index, value)} disabled={generating} options={durationOptions.map((value) => ({ value, label: `${value} 秒` }))} />
                        </label>
                    ))}
                </div>
            </section>
            <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-foreground/60">文本模型</span>
                    <ModelPicker
                        config={effectiveConfig}
                        value={textModel || effectiveConfig.textModel}
                        onChange={setTextModel}
                        capability="text"
                        fullWidth
                        variant="creation"
                        placeholder="选择文本模型"
                        onMissingConfig={() => navigate(settingsPath("models"))}
                    />
                </div>
                <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-foreground/60">图片模型</span>
                    <ModelPicker
                        config={effectiveConfig}
                        value={imageModel || effectiveConfig.imageModel}
                        onChange={setImageModel}
                        capability="image"
                        fullWidth
                        variant="creation"
                        placeholder="选择图片模型"
                        onMissingConfig={() => navigate(settingsPath("models"))}
                    />
                </div>
                <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-foreground/60">视频模型</span>
                    <ModelPicker
                        config={effectiveConfig}
                        value={videoModel || effectiveConfig.videoModel}
                        onChange={setVideoModel}
                        capability="video"
                        fullWidth
                        variant="creation"
                        placeholder="选择视频模型"
                        onMissingConfig={() => navigate(settingsPath("models"))}
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-4 py-3">
                <span className="text-xs text-foreground/50">{selectedStyle ? `画风：${selectedStyle.title}，将应用到角色、分镜图与镜头视频提示词` : "画风用于统一角色、场景与画面质感"}</span>
                <Button size="small" icon={<Palette className="size-3.5" />} disabled={generating} onClick={() => setStylePickerOpen(true)}>
                    {selectedStyle ? `画风：${selectedStyle.title}` : "选择画风（可选）"}
                </Button>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 px-4 py-3">
                <div>
                    <div className="text-sm font-medium">全自动制作成片</div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">默认关闭。开启后会继续补齐分镜图、镜头视频、旁白和 BGM，并自动提交一键成片，连续产生多次生成任务和积分消耗。</p>
                    <p className="mt-1 text-xs leading-5 text-foreground/40">{musicModel ? `BGM 模型：${modelDisplayName(effectiveConfig, musicModel)}` : "未配置 audio.music 模型，自动成片将跳过 BGM。"}</p>
                </div>
                <Switch checked={autoRun} onChange={setAutoRun} disabled={generating} aria-label="全自动制作成片" />
            </div>
            <div className="rounded-xl bg-[color-mix(in_srgb,var(--workspace-accent)_7%,transparent)] px-4 py-3 text-xs leading-6 text-foreground/60">
                {autoRun ? "项目与分镜 → 全部分镜图 → 全部镜头视频 → 旁白 + BGM → MP4/SRT 成片。执行期间请保持页面打开。" : "项目与分镜创建后，可在分镜工作台逐步生成图片、视频和成片。"}图片和视频生成使用上方选择的模型，旁白与 BGM
                使用平台音频功能模型。费用按实际任务账单结算。
            </div>
            {status ? (
                <p className="text-xs text-foreground/55" role="status">
                    {status}
                </p>
            ) : null}
            <div className="flex justify-end gap-2">
                <Button disabled={generating} onClick={requestClose}>
                    取消
                </Button>
                <Button type="primary" icon={<Sparkles className="size-3.5" />} loading={generating} disabled={!topic.trim() || !shotCountValid} onClick={() => void createSmartFilm()}>
                    {generating ? "正在准备分镜" : autoRun ? "创建并自动成片" : "创建并生成分镜"}
                </Button>
            </div>
        </div>
    );

    if (presentation === "page") {
        return (
            <>
                {content}
                <CanvasStylePickerModal
                    open={stylePickerOpen}
                    value={selectedStyle?.id || ""}
                    onClose={() => setStylePickerOpen(false)}
                    onSelect={(preset) => {
                        setSelectedStyle(preset);
                        setStylePickerOpen(false);
                    }}
                />
            </>
        );
    }
    return (
        <>
            <Modal title="智能成片" open={open} footer={null} width={820} closable={!generating} mask={{ closable: false }} keyboard={!generating} onCancel={requestClose}>
                {content}
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id || ""}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => {
                    setSelectedStyle(preset);
                    setStylePickerOpen(false);
                }}
            />
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
