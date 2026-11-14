import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { MediaPlaceholder } from "@/components/ui/product/media-placeholder";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import { ArrowRight, Archive, BookOpenText, Clapperboard, FileText, FolderKanban, Images, LayoutGrid, MoreHorizontal, Palette, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { CanvasStylePickerModal, resolveCanvasStylePreset, resolveProjectCanvasStyle, type CanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { resourceFileUrl } from "@/services/api/resources";
import { ModelPicker } from "@/components/model-picker";
import { isMusicAudioModel } from "@/lib/audio-generation";
import { canvasFeatureModel } from "@/lib/canvas/feature-models";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile } from "@/lib/canvas/style-profile";
import { isValidSmartFilmShotCount, normalizeSmartFilmShotCount, SMART_FILM_DEFAULT_SHOT_COUNT, SMART_FILM_MAX_SHOT_COUNT, SMART_FILM_MIN_SHOT_COUNT } from "@/lib/canvas/smart-film-options";
import { projectSummaryCompletion, projectSummaryStage } from "@/lib/project-workbench";
import { settingsPath } from "@/lib/settings-navigation";
import { PromptTemplateOperation, parseGeneratedStory, promptTemplateTaskPlaceholder, shortDramaOutlineVariables } from "@/lib/prompts";
import { prepareBackendGenerationTask, runBackendGenerationTask } from "@/services/api/generation-task";
import { quoteGenerationTask } from "@/services/api/task-billing";
import { createProject, createProjectAssetCandidates, createProjectUnit, createUnitWorkflow, deleteProject, duplicateProject, getProjectCore, importProjectUnits, listProjectFolders, listProjects, moveProjectToFolder, replaceProjectUnitShots, updateProject, type ProjectSummary } from "@/services/api/projects";
import { modelDisplayName, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { storyboardRowsToProjectShots } from "./detail/chapter-storyboard-production";
import { extractChapterAssets, generateChapterStoryboard } from "./detail/project-chapter-ai";
import { sourceTypeLabel } from "./detail/shared";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ProjectsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [createForm] = Form.useForm<ProjectForm>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [keyword, setKeyword] = useState("");
    const [status, setStatus] = useState<"all" | "active" | "archived">("all");
    const [sort, setSort] = useState<"updated" | "progress" | "name">("updated");
    const [storyDraft, setStoryDraft] = useState("");
    const [createSource, setCreateSource] = useState<"blank" | "novel" | "text">("blank");
    const [selectedStyle, setSelectedStyle] = useState<CanvasStylePreset | null>(null);
    const [stylePickerOpen, setStylePickerOpen] = useState(false);
    const [generateModel, setGenerateModel] = useState("");
    const [generateChapterCount, setGenerateChapterCount] = useState("5");
    const [generateStructure, setGenerateStructure] = useState("单线推进");
    const [generateChapterLength, setGenerateChapterLength] = useState("中");
    const [generateWordCount, setGenerateWordCount] = useState("800");
    const [generatePerspective, setGeneratePerspective] = useState("第三人称");
    const [generateTone, setGenerateTone] = useState("平稳叙事");
    const [generateCharacterScale, setGenerateCharacterScale] = useState("3-4 个");
    const [generating, setGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState("");
    const [generationPreview, setGenerationPreview] = useState("");
    const [smartFilmOpen, setSmartFilmOpen] = useState(false);
    const [smartFilmTopic, setSmartFilmTopic] = useState("");
    const [smartFilmShotCount, setSmartFilmShotCount] = useState<number | null>(SMART_FILM_DEFAULT_SHOT_COUNT);
    const [smartFilmAspectRatio, setSmartFilmAspectRatio] = useState("9:16");
    const [smartFilmTextModel, setSmartFilmTextModel] = useState("");
    const [smartFilmImageModel, setSmartFilmImageModel] = useState("");
    const [smartFilmVideoModel, setSmartFilmVideoModel] = useState("");
    const [smartFilmAutoRun, setSmartFilmAutoRun] = useState(true);
    const [smartFilmGenerating, setSmartFilmGenerating] = useState(false);
    const [smartFilmStatus, setSmartFilmStatus] = useState("");
    const [smartFilmEstimate, setSmartFilmEstimate] = useState<{ loading: boolean; imagePoints?: number; videoPoints?: number; totalPoints?: number; error?: string }>({ loading: false });
    const [renamingProject, setRenamingProject] = useState<ProjectSummary["project"] | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const smartFilmMusicModel = useMemo(
        () => canvasFeatureModel("audio.music") || (effectiveConfig.audioModels || []).find(isMusicAudioModel) || "",
        [effectiveConfig],
    );
    const smartFilmShotCountValid = isValidSmartFilmShotCount(smartFilmShotCount);
    const smartFilmShotCountValue = normalizeSmartFilmShotCount(smartFilmShotCount);
    const foldersQuery = useQuery({ queryKey: ["project-folders"], queryFn: listProjectFolders });
    const createOpen = searchParams.get("create") === "1";
    const setCreateOpen = (open: boolean) => {
        const next = new URLSearchParams(searchParams);
        if (open) next.set("create", "1");
        else next.delete("create");
        setSearchParams(next, { replace: true });
    };
    const openCreate = (source: "blank" | "novel" | "text") => {
        setCreateSource(source);
        setCreateOpen(true);
    };
    const openSmartFilm = () => {
        setSmartFilmTopic(storyDraft.trim());
        setSmartFilmTextModel(effectiveConfig.textModel || "");
        setSmartFilmImageModel(effectiveConfig.imageModel || "");
        setSmartFilmVideoModel(effectiveConfig.videoModel || "");
        setSmartFilmAutoRun(true);
        setSmartFilmOpen(true);
    };
    useEffect(() => {
        if (searchParams.get("smart") !== "1") return;
        setSmartFilmTopic(storyDraft.trim());
        setSmartFilmTextModel(effectiveConfig.textModel || "");
        setSmartFilmImageModel(effectiveConfig.imageModel || "");
        setSmartFilmVideoModel(effectiveConfig.videoModel || "");
        setSmartFilmAutoRun(true);
        setSmartFilmOpen(true);
        const next = new URLSearchParams(searchParams);
        next.delete("smart");
        setSearchParams(next, { replace: true });
    }, [effectiveConfig.imageModel, effectiveConfig.textModel, effectiveConfig.videoModel, searchParams, setSearchParams, storyDraft]);
    useEffect(() => {
        if (!smartFilmOpen || !smartFilmAutoRun) {
            setSmartFilmEstimate({ loading: false });
            return;
        }
        if (!smartFilmShotCountValid) {
            setSmartFilmEstimate({ loading: false, error: `请输入 ${SMART_FILM_MIN_SHOT_COUNT}–${SMART_FILM_MAX_SHOT_COUNT} 之间的整数分镜数量` });
            return;
        }
        const imageModel = smartFilmImageModel || effectiveConfig.imageModel;
        const videoModel = smartFilmVideoModel || effectiveConfig.videoModel;
        if (!imageModel || !videoModel) {
            setSmartFilmEstimate({ loading: false, error: "选择图片和视频模型后显示预估费用" });
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setSmartFilmEstimate({ loading: true });
            try {
                const shotCount = smartFilmShotCountValue;
                const [imageInput, videoInput] = await Promise.all([
                    prepareBackendGenerationTask({
                        projectId: "smart-film-estimate",
                        mode: "image",
                        prompt: "智能成片分镜图费用预估",
                        config: { ...effectiveConfig, model: imageModel, imageModel, size: smartFilmAspectRatio, quality: effectiveConfig.quality || "auto" },
                    }),
                    prepareBackendGenerationTask({
                        projectId: "smart-film-estimate",
                        mode: "video",
                        prompt: "智能成片镜头视频费用预估",
                        config: { ...effectiveConfig, model: videoModel, videoModel, size: smartFilmAspectRatio, vquality: effectiveConfig.vquality || "720", videoSeconds: "5" },
                    }),
                ]);
                const [imageQuote, videoQuote] = await Promise.all([quoteGenerationTask(imageInput), quoteGenerationTask(videoInput)]);
                if (cancelled) return;
                if (!imageQuote.enabled || !videoQuote.enabled) {
                    setSmartFilmEstimate({ loading: false, error: "当前套餐未启用积分计费" });
                    return;
                }
                setSmartFilmEstimate({
                    loading: false,
                    imagePoints: imageQuote.points * shotCount,
                    videoPoints: videoQuote.points * shotCount,
                    totalPoints: (imageQuote.points + videoQuote.points) * shotCount,
                });
            } catch (error) {
                if (!cancelled) setSmartFilmEstimate({ loading: false, error: error instanceof Error ? error.message : "费用预估失败" });
            }
        }, 280);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [effectiveConfig, smartFilmAspectRatio, smartFilmAutoRun, smartFilmImageModel, smartFilmOpen, smartFilmShotCountValid, smartFilmShotCountValue, smartFilmVideoModel]);
    useEffect(() => {
        if (!createOpen) return;
        createForm.setFieldsValue({
            name: storyDraft.trim().slice(0, 24) || "",
            sourceType: createSource,
            aspectRatio: "9:16",
        });
    }, [createForm, createOpen, createSource, storyDraft]);

    const generateStory = async () => {
        const story = storyDraft.trim();
        if (!story || generating) return;
        const textModel = generateModel || effectiveConfig.textModel;
        if (!textModel || !effectiveConfig.textModels.includes(textModel)) {
            if (!textModel) {
                modal.warning({
                    title: "需要先选择文本模型",
                    content: "请在上方“AI 模型”中选择一个已配置的文本模型，或先到设置中完成模型渠道配置。",
                    okText: "去设置",
                    cancelText: "取消",
                    onOk: () => navigate(settingsPath("models")),
                });
            } else {
                message.error(`模型 ${textModel} 未在文本模型列表中，请重新选择`);
            }
            return;
        }
        setGenerating(true);
        setGenerationStatus("正在创建项目…");
        setGenerationPreview("");
        try {
            const project = await createUniqueProject(story, {
                type: "short-drama",
                aspectRatio: "9:16",
                sourceType: "blank",
                description: story,
                ...(selectedStyle ? {
                    stylePresetId: selectedStyle.id,
                    styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)),
                } : {}),
            });
            setGenerationStatus("AI 正在生成故事大纲与章节…");
            const result = await runBackendGenerationTask({
                projectId: project.project.id,
                mode: "text",
                prompt: promptTemplateTaskPlaceholder("短剧大纲"),
                config: { ...effectiveConfig, model: textModel, imageModel: textModel, videoModel: textModel, textModel },
                metadata: {
                    source: "project-story-generator",
                    projectId: project.project.id,
                    promptTemplateOperation: PromptTemplateOperation.ShortDramaOutline,
                    promptTemplateVariables: shortDramaOutlineVariables({
                        story,
                        chapterCount: generateChapterCount,
                        structure: generateStructure,
                        wordCount: generateWordCount,
                        perspective: generatePerspective,
                        tone: generateTone,
                        characterScale: generateCharacterScale,
                        chapterLength: generateChapterLength,
                    }),
                },
                onTextDelta: setGenerationPreview,
            });
            const answer = result.text || "";
            const parsed = parseGeneratedStory(answer);
            if (!parsed.chapters.length) throw new Error("AI 没有返回有效的章节内容，请重试");
            setGenerationStatus(`正在导入 ${parsed.chapters.length} 个章节…`);
            await importProjectUnits(project.project.id, parsed.chapters.map((chapter: { title: string; content: string }) => ({ kind: "chapter", title: chapter.title, sourceText: chapter.content })));
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.project.id}/overview`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI 生成失败，请重试");
        } finally {
            setGenerating(false);
            setGenerationStatus("");
            setGenerationPreview("");
        }
    };
    const createSmartFilm = async () => {
        const topic = smartFilmTopic.trim();
        const textModel = smartFilmTextModel || effectiveConfig.textModel;
        const imageModel = smartFilmImageModel || effectiveConfig.imageModel;
        const videoModel = smartFilmVideoModel || effectiveConfig.videoModel;
        if (!topic || smartFilmGenerating) return;
        if (!smartFilmShotCountValid) {
            modal.warning({ title: "分镜数量无效", content: `请输入 ${SMART_FILM_MIN_SHOT_COUNT}–${SMART_FILM_MAX_SHOT_COUNT} 之间的整数。`, okText: "知道了" });
            return;
        }
        const shotCount = normalizeSmartFilmShotCount(smartFilmShotCount);
        if (!textModel || !imageModel || !videoModel) {
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
            ["文本", textModel],
            ["图片", imageModel],
            ["视频", videoModel],
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
        setSmartFilmGenerating(true);
        setSmartFilmStatus("正在创建项目…");
        try {
            const project = await createUniqueProject(topic, {
                type: smartFilmAutoRun ? "smart-film-auto" : "smart-film",
                aspectRatio: smartFilmAspectRatio,
                sourceType: "text",
                description: topic,
                defaultImageModel: imageModel,
                defaultVideoModel: videoModel,
                ...(selectedStyle ? {
                    stylePresetId: selectedStyle.id,
                    styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)),
                } : {}),
            });
            setSmartFilmStatus("正在创建章节与制作流程…");
            const { unit } = await createProjectUnit(project.project.id, {
                kind: "chapter",
                title: project.project.name,
                sourceText: topic,
                position: 0,
            });
            await createUnitWorkflow(project.project.id, unit.id);
            const core = await getProjectCore(project.project.id);
            let approvedRevision = core.project.revision;
            let characters: Array<{ name: string; definition: Record<string, unknown> }> = [];
            let assets: Array<{ id: string; title: string; type: "image"; category: string; tags: string[]; prompt: string }> = [];
            try {
                setSmartFilmStatus("正在提取角色、场景和道具…");
                const extracted = await extractChapterAssets({
                    projectId: project.project.id,
                    projectName: project.project.name,
                    chapterId: unit.id,
                    chapterTitle: unit.title,
                    sourceText: topic,
                    projectStyle: selectedStyle?.prompt || "",
                    config: { ...effectiveConfig, model: textModel, textModel, imageModel, videoModel },
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
            setSmartFilmStatus(`正在规划 ${shotCount} 个镜头…`);
            const generated = await generateChapterStoryboard({
                projectId: project.project.id,
                chapterId: unit.id,
                chapterTitle: unit.title,
                sourceText: topic,
                projectStyle: selectedStyle ? {
                    presetId: selectedStyle.id,
                    title: selectedStyle.title,
                    prompt: selectedStyle.prompt,
                    profileJson: selectedStyle.profile ? serializeStyleProfile(selectedStyle.profile) : undefined,
                } : { presetId: "", title: "", prompt: "" },
                characters,
                assets,
                config: { ...effectiveConfig, model: textModel, textModel, imageModel, videoModel },
                skills: [],
                selectedSkillIds: [],
                approvedRevision,
                approvedShotIds: [],
                shotCount,
                userRequirements: `这是一条从主题直接启动的成片项目。主题：${topic}\n画面以 AI 生成图片和视频为主，分镜要能直接继续生成首帧和镜头视频。`,
            });
            if (!generated.rows.length) throw new Error("模型没有返回有效分镜，请重试");
            if (generated.rows.length < shotCount) {
                throw new Error(`模型只返回了 ${generated.rows.length} 个分镜，少于要求的 ${shotCount} 个，请重试`);
            }
            setSmartFilmStatus("正在写入分镜…");
            const shots = storyboardRowsToProjectShots(generated.rows.slice(0, shotCount));
            await replaceProjectUnitShots(project.project.id, unit.id, shots, [], approvedRevision, { sourceTaskId: generated.taskId });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["projects"] }),
                queryClient.invalidateQueries({ queryKey: ["project", project.project.id] }),
            ]);
            setSmartFilmOpen(false);
            message.success(smartFilmAutoRun ? `已生成 ${shots.length} 个分镜，开始自动制作成片` : `已生成 ${shots.length} 个分镜，图片与视频模型已写入项目默认配置`);
            navigate(`/projects/${project.project.id}/workflow/${unit.id}/storyboard${smartFilmAutoRun ? "?autostart=1" : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "智能成片创建失败，请重试");
        } finally {
            setSmartFilmGenerating(false);
            setSmartFilmStatus("");
        }
    };
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const query = useInfiniteQuery({
        // 分页查询和画布页的全量项目查询不能共用缓存形状，否则两个页面会互相覆盖缓存数据。
        queryKey: ["projects", "paged"],
        queryFn: ({ pageParam }) => listProjects({ page: pageParam, pageSize: 50 }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setCreateOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.id}/overview`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目创建失败"),
    });
    const deleteMutation = useMutation({
        mutationFn: deleteProject,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("项目已删除");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目删除失败"),
    });
    const archiveMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: string }) => updateProject(id, { status }),
        onSuccess: (_, variables) => {
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success(variables.status === "archived" ? "项目已归档" : "项目已恢复");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目状态更新失败"),
    });
    const renameMutation = useMutation({
        mutationFn: ({ id, name }: { id: string; name: string }) => updateProject(id, { name }),
        onSuccess: () => {
            setRenamingProject(null);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("项目已重命名");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目重命名失败"),
    });
    const allProjects = useMemo(() => query.data?.pages.flatMap((page) => page.projects) || [], [query.data]);
    const rows = useMemo(() => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        return [...allProjects]
            .filter(({ project }) => status === "all" || project.status === status)
            .filter(({ project }) => !normalizedKeyword || `${project.name} ${project.description} ${project.stylePresetId} ${parseStyleProfile(project.styleProfileJson)?.title || resolveCanvasStylePreset(project.stylePresetId)?.title || ""}`.toLowerCase().includes(normalizedKeyword))
            .sort((left, right) => {
                if (sort === "name") return left.project.name.localeCompare(right.project.name, "zh-CN");
                if (sort === "progress") return projectSummaryCompletion(right) - projectSummaryCompletion(left);
                return right.project.updatedAt.localeCompare(left.project.updatedAt);
            });
    }, [allProjects, keyword, sort, status]);
    const totalProjectCount = query.data?.pages[0]?.total ?? allProjects.length;
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !query.hasNextPage || query.isError) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting && !query.isFetchingNextPage) void query.fetchNextPage();
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [query.fetchNextPage, query.hasNextPage, query.isError, query.isFetchingNextPage]);
    const hasInitialError = query.isError && !query.data;
    return (
        <WorkspacePage className="library-page project-library-page" grid>
            <PageHeader title="短剧工作台" description="你的故事、章节与镜头，都在这里。" meta={<span className="app-projects-header-meta">{totalProjectCount} 个项目</span>} />
            <details className="story-launcher-panel" aria-label="开始一部新短剧">
                <summary className="story-launcher-head">
                    <div className="story-launcher-title">
                        <span className="story-launcher-mark"><Sparkles className="size-4" /></span>
                        <div>
                            <h2>开始一部新短剧</h2>
                            <p>一句话生成章节，也可以导入小说或从空白开始</p>
                        </div>
                    </div>
                    <span className="story-launcher-expand"><Plus className="size-4" /><span>展开创作</span></span>
                </summary>
                <div className="story-launcher-main">
                    <Input.TextArea
                        className="story-launcher-input"
                        value={storyDraft}
                        onChange={(event) => setStoryDraft(event.target.value)}
                        placeholder="例如：一个失忆的快递员，每天收到十年前寄出的信件……"
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        aria-label="一句话故事"
                    />
                    {selectedStyle ? <button type="button" className="story-launcher-style-chip" onClick={() => setStylePickerOpen(true)} title={selectedStyle.title}>
                        <img src={selectedStyle.imageUrl} alt="" />
                        <span>{selectedStyle.title}</span>
                    </button> : null}
                </div>
                    <div className="story-launcher-actions">
                        <Button icon={<FolderKanban />} onClick={() => openCreate("blank")}>空白项目</Button>
                        <Button icon={<FileText />} onClick={() => openCreate("novel")}>导入小说</Button>
                        <Button icon={<Palette />} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? "更换画风" : "选画风"}</Button>
                        <ModelPicker
                            config={effectiveConfig}
                            value={generateModel || effectiveConfig.textModel}
                            onChange={setGenerateModel}
                            capability="text"
                            variant="creation"
                            placeholder="选择文本模型"


                            popoverClassName="agent-model-picker-popover"
                        />
                        <Button type="default" icon={<Sparkles className="size-3.5" />} disabled={!storyDraft.trim() || generating} loading={generating} onClick={() => void generateStory()}>AI 生成章节</Button>
                        <Button type="default" icon={<Clapperboard className="size-3.5" />} disabled={generating} onClick={openSmartFilm}>智能成片</Button>
                        <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => openCreate(createSource)}>开始创作</Button>
                    </div>
                <details className="story-launcher-options">
                    <summary>故事设置 · {generateChapterCount} 章 · {generatePerspective} · {generateTone}</summary>
                <div className="story-launcher-controls">
                    <label><span>章节数量</span><Select size="small" className="min-w-28" value={generateChapterCount} onChange={setGenerateChapterCount} options={[{ label: "3 章", value: "3" }, { label: "5 章", value: "5" }, { label: "8 章", value: "8" }, { label: "10 章", value: "10" }]} /></label>
                    <label><span>叙事结构</span><Select size="small" className="min-w-32" value={generateStructure} onChange={setGenerateStructure} options={[{ label: "单线推进", value: "单线推进" }, { label: "双线并行", value: "双线并行" }, { label: "群像多线", value: "群像多线" }, { label: "反转嵌套", value: "反转嵌套" }]} /></label>
                    <label><span>章节篇幅</span><Select size="small" className="min-w-28" value={generateChapterLength} onChange={setGenerateChapterLength} options={[{ label: "精炼", value: "短" }, { label: "均衡", value: "中" }, { label: "丰满", value: "长" }]} /></label>
                    <label><span>单章字数</span><Select size="small" className="min-w-28" value={generateWordCount} onChange={setGenerateWordCount} options={[{ label: "500 字", value: "500" }, { label: "800 字", value: "800" }, { label: "1200 字", value: "1200" }, { label: "2000 字", value: "2000" }]} /></label>
                    <label><span>叙述视角</span><Select size="small" className="min-w-28" value={generatePerspective} onChange={setGeneratePerspective} options={[{ label: "第三人称", value: "第三人称" }, { label: "第一人称", value: "第一人称" }, { label: "多视角", value: "多视角" }]} /></label>
                    <label><span>故事基调</span><Select size="small" className="min-w-32" value={generateTone} onChange={setGenerateTone} options={[{ label: "平稳叙事", value: "平稳叙事" }, { label: "轻松喜剧", value: "轻松喜剧" }, { label: "紧张悬疑", value: "紧张悬疑" }, { label: "热血成长", value: "热血成长" }, { label: "甜宠治愈", value: "甜宠治愈" }]} /></label>
                    <label><span>角色规模</span><Select size="small" className="min-w-28" value={generateCharacterScale} onChange={setGenerateCharacterScale} options={[{ label: "2 个", value: "2 个" }, { label: "3-4 个", value: "3-4 个" }, { label: "5-6 个", value: "5-6 个" }]} /></label>
                </div>
                </details>
            </details>
            <CollectionToolbar active={Boolean(keyword || status !== "all" || sort !== "updated")} onReset={() => { setKeyword(""); setStatus("all"); setSort("updated"); }}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索项目、简介或画风" onChange={(event) => setKeyword(event.target.value)} />
                <Select className="w-32" value={status} onChange={setStatus} options={[{ label: "全部状态", value: "all" }, { label: "进行中", value: "active" }, { label: "已归档", value: "archived" }]} />
                <Select className="w-32" value={sort} onChange={setSort} options={[{ label: "最近更新", value: "updated" }, { label: "章节进度", value: "progress" }, { label: "项目名称", value: "name" }]} />
            </CollectionToolbar>

            {hasInitialError ? <WorkspaceErrorState description={query.error instanceof Error ? query.error.message : "项目列表加载失败"} onRetry={() => void query.refetch()} /> : null}
            {query.isLoading ? <WorkspaceLoadingState label="正在整理项目" detail="读取章节、画布与资产进度" /> : null}
            {!query.isLoading && !hasInitialError && rows.length ? (
                <CollectionGrid className="library-grid project-library-grid">
                    {rows.map((row) => <ProjectRow key={row.project.id} row={row} folders={foldersQuery.data?.folders || []} onDelete={() => modal.confirm({ title: "删除项目？", content: `项目章节、画布关联和素材归属将一并移除「${row.project.name}」，独立画布与素材库原始素材会保留。此操作不可撤销。`, okText: "删除项目", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => deleteMutation.mutateAsync(row.project.id) })} onRename={() => { setRenameValue(row.project.name); setRenamingProject(row.project); }} onArchive={() => archiveMutation.mutate({ id: row.project.id, status: row.project.status === "archived" ? "active" : "archived" })} onDuplicate={async () => { await duplicateProject(row.project.id); await queryClient.invalidateQueries({ queryKey: ["projects"] }); message.success("项目副本已创建"); }} onMove={async (folderId) => { await moveProjectToFolder(row.project.id, folderId); await queryClient.invalidateQueries({ queryKey: ["projects"] }); message.success(folderId ? "项目已移动" : "项目已移出文件夹"); }} />)}
                </CollectionGrid>
            ) : null}
            {!query.isLoading && !hasInitialError ? <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                {query.isFetchingNextPage ? "正在加载更多项目…" : query.isError ? <button type="button" onClick={() => void query.fetchNextPage()}>加载更多失败，点击重试</button> : query.hasNextPage ? "继续下滑加载更多（每页 50 条）" : allProjects.length ? `已加载全部 ${totalProjectCount} 个项目` : null}
            </div> : null}
            {!query.isLoading && !rows.length && !hasInitialError && (keyword || status !== "all") ? (
                <WorkspaceState
                    icon="projects"
                    title={keyword || status !== "all" ? "没有匹配的项目" : "创建第一个故事项目"}
                    description={keyword || status !== "all" ? "调整搜索词或状态筛选后再试。" : "项目会集中保存章节、项目画布、角色场景和制作进度。自由试图可从画布开始。"}
                    action={!keyword && status === "all" ? <Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>创建项目</Button> : undefined}
                />
            ) : null}

            <Modal className="library-modal" title="创建短剧项目" open={createOpen} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)} width={560} styles={{ body: { paddingTop: 12 } }}>
                <Form<ProjectForm> form={createForm} layout="vertical" initialValues={{ aspectRatio: "9:16", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "short-drama", ...(selectedStyle ? { stylePresetId: selectedStyle.id, styleProfileJson: serializeStyleProfile(selectedStyle.profile || createStyleProfileSnapshot(selectedStyle)) } : {}) })}>
                    <div className="mb-4 grid grid-cols-3 gap-2">
                        <button type="button" className={createSource === "blank" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("blank"); createForm.setFieldValue("sourceType", "blank"); }}><FolderKanban className="size-4" /><span>空白开始</span></button>
                        <button type="button" className={createSource === "novel" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("novel"); createForm.setFieldValue("sourceType", "novel"); }}><FileText className="size-4" /><span>导入小说</span></button>
                        <button type="button" className={createSource === "text" ? "app-story-source is-active" : "app-story-source"} onClick={() => { setCreateSource("text"); createForm.setFieldValue("sourceType", "text"); }}><BookOpenText className="size-4" /><span>粘贴文本</span></button>
                    </div>
                    <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: "请输入项目名称" }]}><Input autoFocus placeholder="例如：长安夜行" /></Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label="默认画幅"><Select options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} /></Form.Item>
                        <Form.Item name="sourceType" label="内容来源"><Select options={[{ label: "空白开始", value: "blank" }, { label: "导入小说", value: "novel" }, { label: "粘贴文本", value: "text" }]} /></Form.Item>
                    </div>
                    <Form.Item label="项目画风"><button type="button" className="app-story-modal-style" onClick={() => setStylePickerOpen(true)}>{selectedStyle ? <><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span><em>更换</em></> : <><Palette className="size-4" /><span>选择项目画风（可选）</span></>}</button></Form.Item>
                    <p className="-mt-1 mb-5 text-xs leading-5 text-foreground/48">创建后先进入项目概览。章节、画风和参考资产可以逐步补充。</p>
                    <div className="flex justify-end gap-2"><Button onClick={() => setCreateOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>创建项目</Button></div>
                </Form>
            </Modal>
            <Modal className="library-modal" title="重命名项目" open={Boolean(renamingProject)} okText="保存" cancelText="取消" confirmLoading={renameMutation.isPending} onCancel={() => setRenamingProject(null)} onOk={() => { const name = renameValue.trim(); if (!renamingProject || !name) return; renameMutation.mutate({ id: renamingProject.id, name }); }}>
                <Input autoFocus value={renameValue} maxLength={80} placeholder="请输入项目名称" onChange={(event) => setRenameValue(event.target.value)} onPressEnter={() => { const name = renameValue.trim(); if (renamingProject && name) renameMutation.mutate({ id: renamingProject.id, name }); }} />
            </Modal>
            <CanvasStylePickerModal
                open={stylePickerOpen}
                value={selectedStyle?.id}
                onClose={() => setStylePickerOpen(false)}
                onSelect={(preset) => { setSelectedStyle(preset); setStylePickerOpen(false); }}
            />
            <Modal
                className="library-modal"
                title="智能成片"
                open={smartFilmOpen}
                footer={null}
                destroyOnHidden
                closable={!smartFilmGenerating}
                mask={{ closable: !smartFilmGenerating }}
                keyboard={!smartFilmGenerating}
                onCancel={() => setSmartFilmOpen(false)}
                width={780}
                styles={{ body: { paddingTop: 12 } }}
            >
                <div className="space-y-5">
                    <div className="rounded-xl border border-border/70 bg-surface p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Clapperboard className="size-4 text-[var(--workspace-accent)]" />从主题直接生成可编辑分镜</div>
                        <p className="mt-2 text-xs leading-5 text-foreground/50">先生成镜头脚本，再在分镜工作台使用你选择的图片与视频模型继续制作。模型选择会保存为项目默认值，后续镜头生成直接沿用。</p>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-foreground/60" htmlFor="smart-film-topic">视频主题或文案</label>
                        <Input.TextArea
                            id="smart-film-topic"
                            value={smartFilmTopic}
                            onChange={(event) => setSmartFilmTopic(event.target.value)}
                            placeholder="例如：用 30 秒讲清楚为什么冬天更容易静电，要求画面明亮、节奏快、适合竖屏短视频"
                            autoSize={{ minRows: 4, maxRows: 8 }}
                            disabled={smartFilmGenerating}
                        />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1.5 text-xs font-medium text-foreground/60"><span>分镜数量</span><InputNumber className="w-full" value={smartFilmShotCount} onChange={setSmartFilmShotCount} disabled={smartFilmGenerating} min={SMART_FILM_MIN_SHOT_COUNT} max={SMART_FILM_MAX_SHOT_COUNT} step={1} precision={0} suffix="镜" aria-label="分镜数量" /></label>
                        <label className="space-y-1.5 text-xs font-medium text-foreground/60"><span>成片画幅</span><Select className="w-full" value={smartFilmAspectRatio} onChange={setSmartFilmAspectRatio} disabled={smartFilmGenerating} options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} /></label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5"><span className="block text-xs font-medium text-foreground/60">文本模型</span><ModelPicker config={effectiveConfig} value={smartFilmTextModel || effectiveConfig.textModel} onChange={setSmartFilmTextModel} capability="text" fullWidth variant="creation" placeholder="选择文本模型" onMissingConfig={() => navigate(settingsPath("models"))} /></div>
                        <div className="space-y-1.5"><span className="block text-xs font-medium text-foreground/60">图片模型</span><ModelPicker config={effectiveConfig} value={smartFilmImageModel || effectiveConfig.imageModel} onChange={setSmartFilmImageModel} capability="image" fullWidth variant="creation" placeholder="选择图片模型" onMissingConfig={() => navigate(settingsPath("models"))} /></div>
                        <div className="space-y-1.5"><span className="block text-xs font-medium text-foreground/60">视频模型</span><ModelPicker config={effectiveConfig} value={smartFilmVideoModel || effectiveConfig.videoModel} onChange={setSmartFilmVideoModel} capability="video" fullWidth variant="creation" placeholder="选择视频模型" onMissingConfig={() => navigate(settingsPath("models"))} /></div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-4 py-3">
                        <span className="text-xs text-foreground/50">画风用于统一角色、场景与画面质感</span>
                        <Button size="small" icon={<Palette className="size-3.5" />} disabled={smartFilmGenerating} onClick={() => setStylePickerOpen(true)}>{selectedStyle ? `画风：${selectedStyle.title}` : "选择画风（可选）"}</Button>
                    </div>
                    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 px-4 py-3">
                        <div><div className="text-sm font-medium">全自动制作成片</div><p className="mt-1 text-xs leading-5 text-foreground/48">生成分镜后继续补齐分镜图和镜头视频，有台词镜头会使用平台 TTS 模型生成旁白，并使用音乐功能模型生成 BGM，全部完成后自动提交一键成片。会连续产生多次生成任务和积分消耗。</p><p className="mt-1 text-xs leading-5 text-foreground/40">{smartFilmMusicModel ? `BGM 模型：${modelDisplayName(effectiveConfig, smartFilmMusicModel)}` : "未配置 audio.music 模型，自动成片将跳过 BGM。"}</p></div>
                        <Switch checked={smartFilmAutoRun} onChange={setSmartFilmAutoRun} disabled={smartFilmGenerating} aria-label="全自动制作成片" />
                    </div>
                    {smartFilmAutoRun ? <div className="rounded-xl border border-border/70 px-4 py-3 text-xs leading-5 text-foreground/55">
                        {smartFilmEstimate.loading ? "正在计算全流程预估费用…" : smartFilmEstimate.error ? smartFilmEstimate.error : smartFilmEstimate.totalPoints !== undefined ? `预计 ${smartFilmShotCountValue} 镜约 ${smartFilmEstimate.totalPoints} 积分（分镜图 ${smartFilmEstimate.imagePoints} + 视频 ${smartFilmEstimate.videoPoints}），旁白与 BGM 按实际任务另计。按每镜约 5 秒估算，实际以任务账单为准。` : "选择模型后显示预估费用"}
                    </div> : null}
                    <div className="rounded-xl bg-[color-mix(in_srgb,var(--workspace-accent)_7%,transparent)] px-4 py-3 text-xs leading-6 text-foreground/60">
                        {smartFilmAutoRun ? "主题 → 分镜 → 全部分镜图 → 全部镜头视频 → 旁白 + BGM → MP4/SRT 成片。执行期间请保持页面打开。" : "主题 → 分镜。图片和视频可在分镜工作台继续手动生成。"}图片和视频生成使用上方选择的模型，旁白与 BGM 使用平台音频功能模型。
                    </div>
                    {smartFilmStatus ? <p className="text-xs text-foreground/55" role="status">{smartFilmStatus}</p> : null}
                    <div className="flex justify-end gap-2">
                        <Button disabled={smartFilmGenerating} onClick={() => setSmartFilmOpen(false)}>取消</Button>
                        <Button type="primary" icon={<Sparkles className="size-3.5" />} loading={smartFilmGenerating} disabled={!smartFilmTopic.trim() || !smartFilmShotCountValid} onClick={() => void createSmartFilm()}>{smartFilmGenerating ? "正在准备分镜" : smartFilmAutoRun ? "创建并自动成片" : "创建并生成分镜"}</Button>
                    </div>
                </div>
            </Modal>
            <Modal className="library-modal" title="AI 生成章节" open={generating} footer={null} closable={false} mask={{ closable: false }} keyboard={false} width={760}>
                <div className="app-story-generating">
                    <div className="app-story-generating-head">
                        <span className="app-story-generating-mark"><Sparkles className="size-4" /></span>
                        <div className="min-w-0">
                            <p>AI 正在创作</p>
                            <span className="block text-[var(--fs-tiny)] text-foreground/45">正在生成剧名、简介与章节</span>
                        </div>
                        {generateModel || effectiveConfig.textModel ? <span className="app-story-generating-model">{modelDisplayName(effectiveConfig, generateModel || effectiveConfig.textModel)}</span> : null}
                    </div>
                    <div className="app-story-generating-progress" aria-hidden="true" />
                    <div className="app-story-generating-grid">
                        <div className="app-story-generating-story">
                            <span className="app-story-generating-caption">故事起点</span>
                            <p>{storyDraft.trim() || "等待故事输入"}</p>
                            <span className="app-story-generating-meta">{generateChapterCount} 章 · 每章约 {generateWordCount} 字 · {generateStructure} · {generatePerspective}</span>
                            {selectedStyle ? <span className="app-story-generating-style"><img src={selectedStyle.imageUrl} alt="" /><span>{selectedStyle.title}</span></span> : null}
                        </div>
                        <ol className="app-story-generating-steps">
                            {generationSteps.map((step) => {
                                const state = generationStatus.startsWith(step.label) ? "is-active" : generationStepDone(step.label, generationStatus) ? "is-done" : "";
                                return <li key={step.label} className={state}><span className="app-story-generating-step-dot" /><span>{step.label}</span><em>{state === "is-active" ? "进行中" : state === "is-done" ? "完成" : "等待"}</em></li>;
                            })}
                        </ol>
                    </div>
                    <div className="app-story-generating-preview">
                        <div className="app-story-generating-preview-head"><span>实时草稿</span><span className="app-story-generating-live" /><em>{generationPreview ? "正在输出" : "等待模型输出"}</em></div>
                        <pre>{generationPreview}</pre>
                    </div>
                </div>
            </Modal>
        </WorkspacePage>
    );
}

type NewProjectInput = Omit<Parameters<typeof createProject>[0], "name">;

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

const generationSteps = [
    { label: "正在创建项目" },
    { label: "AI 正在生成故事大纲与章节" },
    { label: "正在导入章节" },
];

function generationStepDone(label: string, status: string) {
    if (label === "正在创建项目") return status.startsWith("AI 正在生成") || status.startsWith("正在导入");
    if (label === "AI 正在生成故事大纲与章节") return status.startsWith("正在导入");
    return false;
}

function ProjectRow({ row, folders, onDelete, onRename, onArchive, onDuplicate, onMove }: { row: ProjectSummary; folders: { id: string; name: string }[]; onDelete: () => void; onRename: () => void; onArchive: () => void; onDuplicate: () => Promise<void>; onMove: (folderId: string) => Promise<void> }) {
    const navigate = useNavigate();
    const completion = projectSummaryCompletion(row);
    const stage = projectSummaryStage(row);
    const projectStyle = resolveProjectCanvasStyle(row.project.stylePresetId, row.project.styleProfileJson);
    const styleTitle = projectStyle?.title || parseStyleProfile(row.project.styleProfileJson)?.title || resolveCanvasStylePreset(row.project.stylePresetId)?.title || (row.project.stylePresetId ? "自定义画风" : "未设置画风");
    const coverUrl = row.project.coverResourceId ? resourceFileUrl(row.project.coverResourceId) : projectStyle?.imageUrl;
    return (
        <Link to={`/projects/${row.project.id}/overview`} className="product-collection-card library-card project-library-card group">
            <span className="project-library-cover">
                {coverUrl ? <CachedResourceImage className="project-library-cover-art" src={coverUrl} alt="" fallback={<MediaPlaceholder failed />} /> : <MediaPlaceholder label="故事由此开始" />}
                <span className="project-library-cover-scrim" />
                <span className="project-library-cover-ratio">{row.project.aspectRatio}</span>
                <span className="project-library-cover-stage">{stage.label}</span>
                <span className="project-collection-delete" onClick={(event) => event.preventDefault()}><Dropdown trigger={["click"]} placement="bottomRight" overlayClassName="project-library-menu" menu={{ items: [{ key: "open", label: "打开", onClick: () => navigate(`/projects/${row.project.id}/overview`) }, { key: "rename", icon: <Pencil className="size-3.5" />, label: "重命名", onClick: onRename }, { key: "cover", label: "修改封面", onClick: () => navigate(`/projects/${row.project.id}/settings`) }, { key: "duplicate", label: "创建副本", onClick: () => void onDuplicate() }, { key: "move", label: "移动至文件夹", children: [{ key: "root", label: "全部项目", onClick: () => void onMove("") }, ...folders.map((folder) => ({ key: folder.id, label: folder.name, onClick: () => void onMove(folder.id) }))] }, { key: "archive", icon: <Archive className="size-3.5" />, label: row.project.status === "archived" ? "恢复项目" : "归档项目", onClick: onArchive }, { type: "divider" }, { key: "delete", danger: true, label: "删除项目", onClick: onDelete }] }}><button type="button" className="project-library-more" aria-label={`${row.project.name} 更多操作`} onClick={(event) => event.preventDefault()}><MoreHorizontal className="size-4" /></button></Dropdown></span>
            </span>
            <span className="project-library-body">
                <span className="project-library-heading"><strong title={row.project.name}>{row.project.name}</strong>{row.project.status === "archived" ? <em>已归档</em> : null}<ArrowRight className="project-library-arrow size-4" /></span>
                <span className="project-library-date">{row.project.updatedAt.slice(0, 10)}</span>
                <span className="project-library-subtitle">{styleTitle} · {sourceTypeLabel(row.project.sourceType)}</span>
                <span className="project-library-progress"><span><span>{row.completedUnitCount}/{row.unitCount} 章</span><span>{completion}%</span></span><i><b style={{ width: `${completion}%` }} /></i></span>
                <span className="project-library-stats"><ProjectCount icon={<BookOpenText className="size-3.5" />} label="章节" value={row.unitCount} /><ProjectCount icon={<LayoutGrid className="size-3.5" />} label="画布" value={row.canvasCount} /><ProjectCount icon={<Images className="size-3.5" />} label="资产" value={row.assetCount} /></span>
            </span>
        </Link>
    );
}

function ProjectCount({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
    return <span className="inline-flex items-center gap-1.5" title={`${value} ${label}`}><span className="text-foreground/32">{icon}</span><strong className="font-medium tabular-nums text-foreground/65">{value}</strong><span>{label}</span></span>;
}
