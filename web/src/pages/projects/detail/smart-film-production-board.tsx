import { App, Button, Input, Progress } from "antd";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clapperboard, Copy, Download, Edit3, Film, Image as ImageIcon, LoaderCircle, Save, Sparkles, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import { resourceFileUrl, resourceIdFromStorageKey, resourceThumbnailUrl } from "@/services/api/resources";
import type { ProjectDetail, ProjectShot, ShotArtifact, ShotRevision } from "@/services/api/projects";
import type { GenerationTask } from "@/services/api/task-center";
import type { SmartFilmBatch, SmartFilmProductionRun } from "@/services/api/smart-film-batches";
import { controlSmartFilmProductionRun } from "@/services/api/smart-film-batches";

import { promptAssetDisplayTitle, promptAssetIds, promptWithoutAssetMentions } from "./smart-film-storyboard-prompt";
import { autoMentionShotAssetReferences, buildShotAssetReferenceContext, ensureShotAssetMentionPrompt } from "./workflow-shot-references";
import { ArtifactStatus, currentArtifact, currentRevision, formatDuration } from "./workflow-shared";
import { storyboardImageTaskState } from "./smart-film-storyboard-status";

type PromptSaveStatus = "draft" | "confirmed";

export function SmartFilmStoryboardBoard({ detail, batch, shots, readyCount, busy, submittingShotIds, onSaveShotPrompt, onGenerateAll, onGenerateShot, onNext }: {
    detail: ProjectDetail;
    batch?: SmartFilmBatch;
    shots: ProjectShot[];
    readyCount: number;
    busy: boolean;
    submittingShotIds: Set<string>;
    onSaveShotPrompt: (shot: ProjectShot, imagePrompt: string) => Promise<void>;
    onGenerateAll: () => void;
    onGenerateShot: (shot: ProjectShot, imagePrompt?: string) => void;
    onNext: () => void;
}) {
    const { message } = App.useApp();
    const [previewArtifact, setPreviewArtifact] = useState<ShotArtifact | null>(null);
    const [editingPromptShotId, setEditingPromptShotId] = useState<string>();
    const [promptDraft, setPromptDraft] = useState("");
    const [savingPromptShotId, setSavingPromptShotId] = useState<string>();
    const [syncClock, setSyncClock] = useState(() => Date.now());
    const hasPendingSync = shots.some((shot) => {
        const artifact = currentArtifact(detail, shot.id, "storyboard");
        return storyboardImageTaskState(latestStoryboardTask(detail.tasks || [], shot.id), Boolean(artifact?.resourceId && artifact.status === "ready"), syncClock) === "syncing";
    });
    useEffect(() => {
        if (!hasPendingSync) return;
        const timer = window.setInterval(() => setSyncClock(Date.now()), 3_000);
        return () => window.clearInterval(timer);
    }, [hasPendingSync]);
    const allReady = shots.length > 0 && readyCount === shots.length;
    const assetById = new Map(detail.assets.map((asset) => [asset.id, asset]));
    const issues: Array<{ key: string; label: string; tone: "warning" | "danger" }> = [];
    const latestFailures = new Map<string, { task: GenerationTask; count: number }>();
    for (const task of detail.tasks || []) {
        if (task.status !== "failed" || !["storyboard", "smart_film"].includes(task.clientContext?.artifactType || "")) continue;
        const target = `${task.clientContext?.artifactType}:${task.clientContext?.shotId || task.id}`;
        const previous = latestFailures.get(target);
        if (!previous) {
            latestFailures.set(target, { task, count: 1 });
        } else {
            const previousAt = Date.parse(previous.task.createdAt);
            const currentAt = Date.parse(task.createdAt);
            latestFailures.set(target, {
                task: Number.isFinite(currentAt) && (!Number.isFinite(previousAt) || currentAt > previousAt) ? task : previous.task,
                count: previous.count + 1,
            });
        }
    }
    for (const { task, count } of latestFailures.values()) {
        const shotTitle = shots.find((shot) => shot.id === task.clientContext?.shotId)?.title;
        const retryCopy = count > 1 ? `（该镜头连续失败 ${count} 次，仅显示最新一次）` : "";
        issues.push({ key: `task:${task.id}`, label: `${shotTitle || "生成任务"}失败：${task.error || "请重新提交"}${retryCopy}`, tone: "danger" });
    }
    for (const shot of shots) {
        const artifact = currentArtifact(detail, shot.id, "storyboard");
        if (artifact?.status === "stale") issues.push({ key: `stale:${shot.id}`, label: `${shot.title || "镜头"}的分镜图已过期，需要重新生成`, tone: "danger" });
        const revision = currentRevision(detail, shot);
        if (!revision) continue;
        const context = buildShotAssetReferenceContext(detail, shot.id);
        const bound = new Set(context.mentionReferences.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
        const stale = new Set(Array.from(`${revision.imagePrompt || ""}\n${revision.videoPrompt || ""}`.matchAll(/@\[asset:([^\]]+)\]/g), (match) => match[1]).filter((assetId) => !bound.has(assetId)));
        if (stale.size) issues.push({ key: `refs:${shot.id}`, label: `${shot.title || "镜头"}提示词含 ${stale.size} 个未绑定资产引用，提交时会自动忽略`, tone: "warning" });
    }

    const beginPromptEdit = (shot: ProjectShot, imagePrompt: string) => {
        setEditingPromptShotId(shot.id);
        setPromptDraft(promptWithoutAssetMentions(imagePrompt));
    };

    const savePrompt = async (shot: ProjectShot) => {
        if (!promptDraft.trim()) return message.warning("提示词不能为空");
        setSavingPromptShotId(shot.id);
        try {
            await onSaveShotPrompt(shot, promptDraft);
            setEditingPromptShotId(undefined);
            message.success("分镜提示词已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分镜提示词保存失败");
        } finally {
            setSavingPromptShotId(undefined);
        }
    };

    if (!shots.length) {
        return <StoryboardPreparingState detail={detail} batch={batch} />;
    }

    return (
        <section className="h-full min-h-0 overflow-y-auto px-4 py-4 thin-scrollbar">
            <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-foreground/[.06] px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-foreground/55">步骤 1 / 2</span>
                        <strong className="text-sm">生成分镜图</strong>
                        <span className="text-xs text-foreground/42">分镜图就绪 {readyCount}/{shots.length}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">分镜提示词可直接编辑，修改后点击生成会自动保存并提交。可生成需要的分镜图，已有分镜图会加入整片参考。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<Sparkles className="size-4" />} loading={busy} disabled={allReady} onClick={onGenerateAll}>{allReady ? "全部分镜图已生成" : "生成缺失分镜图"}</Button>
                    <Button type="primary" icon={<ArrowRight className="size-4" />} disabled={busy} onClick={onNext}>下一步：整片视频</Button>
                </div>
            </header>

            {issues.length ? <details className="mb-4 rounded-xl border border-amber-300/35 bg-amber-400/[.06] px-4 py-3" open={issues.some((issue) => issue.tone === "danger")}>
                <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-300">待处理问题 {issues.length} 项</summary>
                <ul className="mt-3 grid gap-2 text-xs leading-5 text-foreground/65">
                    {issues.slice(0, 12).map((issue) => <li key={issue.key} className={issue.tone === "danger" ? "text-rose-500" : "text-amber-600 dark:text-amber-400"}>{issue.label}</li>)}
                </ul>
                {issues.length > 12 ? <p className="mt-2 text-[var(--fs-tiny)] text-foreground/40">另有 {issues.length - 12} 项问题，修正当前问题后会自动更新。</p> : null}
            </details> : null}

            <div className="grid gap-3">
                {shots.map((shot, index) => {
                    const revision = currentRevision(detail, shot);
                    const artifact = currentArtifact(detail, shot.id, "storyboard");
                    const ready = Boolean(artifact?.resourceId && artifact.status === "ready");
                    const submitting = submittingShotIds.has(shot.id);
                    const editingPrompt = editingPromptShotId === shot.id;
                    const savingPrompt = savingPromptShotId === shot.id;
                    const imagePrompt = revision?.imagePrompt || "";
                    const task = latestStoryboardTask(detail.tasks || [], shot.id);
                    const taskState = storyboardImageTaskState(task, ready, syncClock);
                    const deliveryFailed = taskState === "delivery-failed";
                    const deliveryLate = taskState === "sync-delayed";
                    const taskRunning = taskState === "generating" || taskState === "syncing";
                    const references = promptAssetIds(imagePrompt).flatMap((assetId) => assetById.get(assetId) || []).slice(0, 8);
                    const generatePrompt = editingPrompt ? promptDraft : undefined;
                    const generateImage = () => {
                        if (generatePrompt !== undefined) setEditingPromptShotId(undefined);
                        onGenerateShot(shot, generatePrompt);
                    };
                    return (
                        <article key={shot.id} className="grid gap-3 rounded-xl border border-border/70 bg-surface p-3 lg:grid-cols-[220px_minmax(0,1fr)_170px]">
                            <button type="button" className="relative aspect-video self-start overflow-hidden rounded-lg border border-border/60 bg-black/20" disabled={!artifact?.resourceId} onClick={() => artifact && setPreviewArtifact(artifact)} aria-label={`查看${shot.title}分镜图`}>
                                {artifact?.resourceId ? <img src={resourceThumbnailUrl(artifact.resourceId, 480)} alt={`${shot.title}分镜图`} className="h-full w-full object-contain" loading="lazy" decoding="async" /> : <span className="grid h-full place-items-center text-foreground/24"><ImageIcon className="size-7" /></span>}
                            </button>

                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-sm">镜头 {String(index + 1).padStart(2, "0")} · {shot.title || "未命名"}</strong>
                                    <span className="text-[var(--fs-tiny)] text-foreground/42">计划 {formatDuration(shot.durationMs)}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-foreground/55">{promptWithoutAssetMentions(revision?.plotDescription || shot.description || "尚未填写镜头画面")}</p>
                                <div className="mt-2 rounded-lg border border-border/60 bg-foreground/[.02] px-2.5 py-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[var(--fs-micro)] font-medium text-foreground/38">分镜画面提示词（图片）</span>
                                        {!editingPrompt ? <Button type="text" size="small" icon={<Edit3 className="size-3.5" />} disabled={busy || taskRunning} onClick={() => beginPromptEdit(shot, imagePrompt)}>编辑</Button> : null}
                                    </div>
                                    {editingPrompt ? (
                                        <div className="mt-2">
                                            <Input.TextArea
                                                value={promptDraft}
                                                onChange={(event) => setPromptDraft(event.target.value)}
                                                autoSize={{ minRows: 4, maxRows: 12 }}
                                                maxLength={8000}
                                                showCount
                                                disabled={busy || taskRunning}
                                                aria-label={`${shot.title}分镜画面提示词`}
                                            />
                                            <div className="mt-2 flex justify-end gap-2">
                                                <Button size="small" icon={<X className="size-3.5" />} disabled={savingPrompt} onClick={() => setEditingPromptShotId(undefined)}>取消</Button>
                                                <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={savingPrompt} disabled={busy || taskRunning || !promptDraft.trim()} onClick={() => void savePrompt(shot)}>保存提示词</Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/58">{promptWithoutAssetMentions(imagePrompt) || "未单独填写；生成时会根据镜头画面与表演信息自动组成图片提示词。"}</p>
                                    )}
                                    {references.length ? (
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="当前镜头参考图">
                                            <span className="text-[var(--fs-micro)] text-foreground/34">参考图</span>
                                            {references.map((asset, referenceIndex) => {
                                                const previewUrl = projectAssetThumbnailUrl(asset);
                                                return (
                                                    <span key={asset.id} className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-border/60 bg-background/35 px-2 py-1 text-[var(--fs-micro)] text-foreground/55" title={asset.title}>
                                                        {previewUrl ? <img src={previewUrl} alt="" className="size-5 rounded-full object-cover" loading="lazy" /> : <ImageIcon className="size-3.5" />}
                                                        <span className="truncate">{promptAssetDisplayTitle(asset.title, asset.category, referenceIndex)}</span>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className="flex flex-col items-stretch justify-between gap-2 lg:items-end">
                                {!ready && (deliveryFailed || deliveryLate) ? <div className="text-xs text-amber-400">{deliveryFailed ? "图片取回失败" : "图片尚未同步"}，<Link to="/tasks" className="underline">查看任务记录</Link></div> : <ArtifactStatus artifact={artifact} taskStatus={submitting ? "queued" : task?.status} />}
                                <Button type="primary" icon={<Sparkles className="size-3.5" />} loading={submitting || taskRunning} disabled={busy || taskRunning || (!ready && (deliveryFailed || deliveryLate))} onClick={generateImage}>{taskRunning ? task?.status === "succeeded" ? "正在取回图片…" : "生成中…" : ready ? "重新生成分镜图" : "生成分镜图"}</Button>
                                {artifact?.resourceId ? <Button type="text" size="small" icon={<ImageIcon className="size-3.5" />} onClick={() => setPreviewArtifact(artifact)}>查看图片</Button> : null}
                            </div>
                        </article>
                    );
                })}
            </div>
            <AppModal
                flush
                open={Boolean(previewArtifact?.resourceId)}
                title="分镜图预览"
                footer={null}
                centered
                maskClosable={false}
                width="min(960px, calc(100vw - 32px))"
                onCancel={() => setPreviewArtifact(null)}
            >
                {previewArtifact?.resourceId ? <img className="workflow-image-preview-modal" src={resourceFileUrl(previewArtifact.resourceId)} alt="分镜图大图" /> : null}
            </AppModal>
        </section>
    );
}

function StoryboardPreparingState({ detail, batch }: { detail: ProjectDetail; batch?: SmartFilmBatch }) {
    const { message } = App.useApp();
    const run = batch?.productionRuns.find((item) =>
        item.scriptId === detail.project.sourceScriptId
        || item.resources.projectId === detail.project.id,
    );
    const task = detail.tasks
        .filter((item) => item.id === run?.storyboardTaskId || (item.type === "canvas_text" && item.operation === "storyboard"))
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const waitState = resolveStoryboardWaitState(task, run);
    const taskActive = waitState === "running";
    const [clock, setClock] = useState(Date.now());
    const [retrying, setRetrying] = useState(false);
    const [retrySubmitted, setRetrySubmitted] = useState(false);
    useEffect(() => {
        if (!taskActive) return;
        setClock(Date.now());
        const timer = window.setInterval(() => setClock(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [taskActive, task?.id]);
    useEffect(() => {
        if (waitState !== "failed") setRetrySubmitted(false);
    }, [waitState]);
    const startedAt = Date.parse(task?.startedAt || task?.createdAt || run?.updatedAt || "");
    const elapsed = taskActive && Number.isFinite(startedAt) ? formatDuration(Math.max(0, clock - startedAt)) : "";
    const error = run?.error || task?.error || "";
    const batchHref = detail.project.batchId ? `/smart-film/batches/${detail.project.batchId}` : "";
    const assetsHref = `/projects/${detail.project.id}/assets`;
    const retryStoryboard = async () => {
        if (!batch || !run || retrying) return;
        setRetrying(true);
        try {
            await controlSmartFilmProductionRun(batch.id, run.id, "retry", "storyboard");
            setRetrySubmitted(true);
            message.success("分镜生成已重新排队");
        } catch (retryError) {
            message.error(retryError instanceof Error ? retryError.message : "分镜重试失败");
        } finally {
            setRetrying(false);
        }
    };

    if (waitState === "failed") {
        return <section className="grid h-full min-h-[320px] place-items-center px-6 text-center" role="alert">
            <div className="max-w-lg rounded-xl border border-rose-300/35 bg-rose-500/[.05] px-6 py-7">
                <X className="mx-auto size-8 text-rose-500" />
                <strong className="mt-4 block text-sm text-rose-600 dark:text-rose-400">分镜脚本生成失败</strong>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-foreground/60">{error || "模型没有返回可用分镜，请检查生成记录后重试。"}</p>
                <p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/42">失败任务不会继续占用后台。可以直接重试；已有可用结果会被优先复用。</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {batch && run ? <Button type="primary" loading={retrying} disabled={retrySubmitted} onClick={() => void retryStoryboard()}>{retrySubmitted ? "已重新排队" : "重试分镜生成"}</Button> : null}
                    {batchHref ? <Link to={batchHref}><Button>打开生成记录</Button></Link> : null}
                    <Link to={assetsHref}><Button>检查角色与资产</Button></Link>
                </div>
            </div>
        </section>;
    }

    const copied = waitState === "syncing";
    return <section className="grid h-full min-h-[320px] place-items-center px-6 text-center" role="status" aria-live="polite">
        <div className="max-w-lg">
            {copied ? <CheckCircle2 className="mx-auto size-8 text-emerald-500" /> : <LoaderCircle className="mx-auto size-8 animate-spin text-foreground/45" />}
            <strong className="mt-4 block text-sm">{copied ? "分镜脚本已返回，正在同步镜头" : taskActive ? "正在生成分镜脚本" : "分镜任务正在排队"}</strong>
            <p className="mt-2 text-xs leading-6 text-foreground/48">
                {copied ? "模型已经完成文本生成，系统正在写入镜头列表，页面会自动刷新。" : "系统正在结合剧本、确认资产和制作规格拆分镜头。"}
            </p>
            <p className="mt-1 text-[var(--fs-tiny)] leading-5 text-foreground/38">
                {taskActive ? `任务已运行 ${elapsed || "不到 1 秒"}。` : ""}当前文本模型通常需要约 3–6 分钟；失败或完成后都会在这里明确显示。
            </p>
            {batchHref ? <Link to={batchHref}><Button className="mt-4">查看后台生成记录</Button></Link> : null}
        </div>
    </section>;
}

export function resolveStoryboardWaitState(task?: GenerationTask, run?: SmartFilmProductionRun): "failed" | "running" | "syncing" | "waiting" {
    if (task?.status === "failed" || task?.status === "cancelled"
        || run?.status === "needs_attention" || run?.status === "failed"
        || run?.storyboardStatus === "needs_attention") {
        return "failed";
    }
    if (task?.status === "succeeded") return "syncing";
    if (task?.status === "queued" || task?.status === "running"
        || run?.storyboardStatus === "queued" || run?.storyboardStatus === "running") {
        return "running";
    }
    return "waiting";
}

export function SmartFilmVideoBoard({ detail, batch, shots, promptPlan, readyCount, targetSeconds, generating, generationError, generationTask, recoveryError, latestResourceId, staleWholeFilm, editPrompt, onBack, onSaveShotPrompt, onGenerate, onDownload }: {
    detail: ProjectDetail;
    batch?: SmartFilmBatch;
    shots: ProjectShot[];
    promptPlan: ReturnType<typeof import("./use-smart-film-whole-film").useSmartFilmWholeFilm>["smartFilmPromptPlan"];
    readyCount: number;
    targetSeconds: number;
    generating: boolean;
    generationError?: string;
    generationTask?: GenerationTask;
    recoveryError?: string;
    latestResourceId?: string;
    staleWholeFilm?: boolean;
    editPrompt?: string;
    onBack: () => void;
    onSaveShotPrompt: (shot: ProjectShot, videoPrompt: string, status: PromptSaveStatus) => Promise<void>;
    onGenerate: () => void;
    onDownload: () => void;
}) {
    const copyText = useCopyText();
    const taskActive = generating || generationTask?.status === "queued" || generationTask?.status === "running";
    const [taskClock, setTaskClock] = useState(() => Date.now());
    useEffect(() => {
        if (!taskActive) return;
        setTaskClock(Date.now());
        const timer = window.setInterval(() => setTaskClock(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [taskActive, generationTask?.id]);
    const taskProgress = Math.max(0, Math.min(100, Math.round(generationTask?.progress || 0)));
    const taskStage = generationTask?.stage || (generationTask?.status === "queued" ? "等待生成资源" : "正在生成整片视频");
    const taskStartedAt = Date.parse(generationTask?.startedAt || generationTask?.createdAt || "");
    const taskElapsed = taskActive && Number.isFinite(taskStartedAt) ? formatDuration(Math.max(0, taskClock - taskStartedAt)) : "";
    const taskPreviewUrl = generationTask?.previewPosterUrl || (generationTask?.previewKind === "image" ? generationTask.previewUrl : "");
    const canGenerate = shots.length > 0 && !taskActive && Boolean(promptPlan.plan) && !promptPlan.plan?.missingInputAssets.length;

    if (!shots.length) return <StoryboardPreparingState detail={detail} batch={batch} />;

    return (
        <section className="h-full min-h-0 overflow-y-auto px-4 py-4 thin-scrollbar">
            <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">

                        <strong className="text-sm">生成整片视频</strong>
                        <span className="text-xs text-foreground/42">分镜图可用 {readyCount}/{shots.length} · 目标 {formatDuration(targetSeconds * 1000)}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/48">生成一条完整视频，已就绪的分镜图与产品、人物资产图将作为参考。逐镜说明会组装为整片提示词。</p>
                    {promptPlan.error ? <p className="mt-1 text-[var(--fs-tiny)] text-rose-500">{promptPlan.error}</p> : null}
                    {promptPlan.plan?.missingInputAssets.length ? <p className="mt-1 text-[var(--fs-tiny)] text-rose-500">无法读取产品或人物参考图：{promptPlan.plan.missingInputAssets.join("、")}</p> : null}
                    {staleWholeFilm && !latestResourceId ? <p className="mt-1 text-[var(--fs-tiny)] text-amber-500">上一版整片视频已因分镜变化而过期，请重新生成后再交付。</p> : null}
                    {generationError ? <p className="mt-1 text-[var(--fs-tiny)] text-rose-500">{generationError}</p> : null}
                    {recoveryError ? <p className="mt-1 text-[var(--fs-tiny)] text-rose-500">产物恢复失败：{recoveryError}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>返回分镜图</Button>
                    <Button icon={<Download className="size-4" />} disabled={!latestResourceId} onClick={onDownload}>下载整片视频</Button>
                    <Button type="primary" title={taskActive ? taskStage : undefined} icon={taskActive ? <LoaderCircle className="size-4 animate-spin" /> : <Video className="size-4" />} loading={taskActive} disabled={!canGenerate} onClick={onGenerate}>{taskActive ? taskProgress ? `整片生成中 ${taskProgress}%` : "整片生成中…" : latestResourceId ? "重新生成整片视频" : "生成整片视频"}</Button>
                </div>
            </header>

            {promptPlan.plan ? <details className="mb-4 rounded-xl border border-border/70 bg-surface p-4" open>
                <summary className="cursor-pointer text-sm font-medium">整片提示词与参考图 · {promptPlan.plan.referenceImages.length} 张</summary>
                <div className="mt-3 flex flex-wrap gap-2">
                    {promptPlan.plan.referenceImages.map((image, index) => <div key={image.id} className="w-28 text-xs text-foreground/60">
                        {image.url ? <img src={image.url} alt={`参考图${index + 1}`} className="aspect-square w-full rounded-lg object-contain" /> : null}
                        <span>参考图{index + 1} · {image.name}</span>
                    </div>)}
                </div>
                <pre className="thin-scrollbar mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/70">{promptPlan.plan.prompt}</pre>
            </details> : null}

            {latestResourceId && editPrompt ? (
                <section className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[.045] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <strong className="text-sm">剪辑提示词已生成</strong>
                            <p className="mt-1 text-xs leading-5 text-foreground/48">已根据整片视频、分镜顺序、动作说明和对白整理，可直接复制到剪辑 Agent 或剪辑软件工作流。</p>
                        </div>
                        <Button type="primary" icon={<Copy className="size-4" />} onClick={() => copyText(editPrompt, "剪辑提示词已复制")}>复制剪辑提示词</Button>
                    </div>
                    <details className="mt-3 rounded-lg border border-border/60 bg-background/35">
                        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground/65">展开查看完整剪辑提示词</summary>
                        <pre className="thin-scrollbar max-h-[420px] overflow-auto whitespace-pre-wrap border-t border-border/60 p-4 text-xs leading-6 text-foreground/72">{editPrompt}</pre>
                    </details>
                </section>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-border/70 bg-surface p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                        <span className="flex items-center gap-2"><Clapperboard className="size-4" />参考分镜清单</span>
                        <span className="text-foreground/38">逐镜编辑总提示词，不是逐镜生成任务</span>
                    </div>
                    <div className="grid gap-3">
                        {shots.map((shot, index) => (
                            <SmartFilmVideoShotRow
                                key={shot.id}
                                detail={detail}
                                shot={shot}
                                index={index}
                                artifact={currentArtifact(detail, shot.id, "storyboard")}
                                revision={currentRevision(detail, shot)}
                                targetSeconds={targetSeconds}
                                busy={generating}
                                onSave={onSaveShotPrompt}
                            />
                        ))}
                    </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-surface p-3 xl:sticky xl:top-3">
                    <div className="flex items-center justify-between gap-2">
                        <strong className="text-xs">整片视频预览</strong>
                        <span className={`rounded-full px-2 py-0.5 text-[var(--fs-micro)] ${taskActive ? "bg-amber-500/10 text-amber-500" : latestResourceId ? "bg-emerald-500/10 text-emerald-500" : generationTask?.status === "failed" ? "bg-rose-500/10 text-rose-500" : "bg-foreground/[.06] text-foreground/42"}`}>{taskActive ? taskProgress ? `生成中 ${taskProgress}%` : "生成中" : latestResourceId ? "已生成" : generationTask?.status === "failed" ? "生成失败" : "待生成"}</span>
                    </div>
                    <div className="mt-2 flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-black/10 p-3">
                        {latestResourceId ? <video src={resourceFileUrl(latestResourceId)} controls className="max-h-[420px] w-full rounded-lg" preload="metadata" /> : taskActive ? <div className="w-full text-center text-foreground/45">
                            {taskPreviewUrl ? <img src={taskPreviewUrl} alt="整片视频生成预览" className="mx-auto mb-4 max-h-64 w-full rounded-lg object-contain" /> : <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-foreground/[.05]"><Film className="size-8" /></span>}
                            <p className="mt-4 text-xs font-medium text-foreground/70">{taskStage}{taskElapsed ? ` · 已运行 ${taskElapsed}` : ""}</p>
                            <Progress className="mt-3 w-full" percent={taskProgress || 5} showInfo={false} status="active" />
                            <p className="mt-2 text-[var(--fs-tiny)] text-foreground/35">{generationTask?.referenceProgress ? "正在准备参考素材，完成后自动进入视频生成" : "视频生成需要一些时间，完成后会显示在这里"}</p>
                        </div> : generationTask?.status === "failed" ? <div className="max-w-sm text-center text-rose-400"><Film className="mx-auto size-9" /><p className="mt-3 text-xs font-medium">整片视频生成失败</p><p className="mt-2 text-[var(--fs-tiny)] leading-5 text-foreground/45">{generationTask.error || "请调整参数后重试"}</p></div> : <div className="text-center text-foreground/38"><Film className="mx-auto size-10" /><p className="mt-2 text-xs">{staleWholeFilm ? "上一版整片视频已过期" : "还没有生成整片视频"}</p><p className="mt-1 text-[var(--fs-tiny)] text-foreground/30">{staleWholeFilm ? "重新生成整片后再交付" : "镜头脚本就绪后可以开始生成"}</p></div>}
                    </div>
                </div>
            </div>
        </section>
    );
}

function SmartFilmVideoShotRow({ detail, shot, index, artifact, revision, targetSeconds, busy, onSave }: {
    detail: ProjectDetail;
    shot: ProjectShot;
    index: number;
    artifact?: ShotArtifact;
    revision?: ShotRevision;
    targetSeconds: number;
    busy: boolean;
    onSave: (shot: ProjectShot, videoPrompt: string, status: PromptSaveStatus) => Promise<void>;
}) {
    const { message } = App.useApp();
    const context = useMemo(() => buildShotAssetReferenceContext(detail, shot.id), [detail, shot.id]);
    const initialPrompt = useMemo(() => normalizePrompt(combineVideoPromptAndAction(revision?.videoPrompt || revision?.plotDescription || shot.description || "", revision?.action || ""), context.mentionReferences), [context.mentionReferences, revision?.action, revision?.plotDescription, revision?.videoPrompt, shot.description]);
    const [prompt, setPrompt] = useState(initialPrompt);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selection, setSelection] = useState({ start: initialPrompt.length, end: initialPrompt.length });
    const [caretRequest, setCaretRequest] = useState<{ offset: number; key: number } | null>(null);
    const ready = Boolean(artifact?.resourceId && artifact.status === "ready");

    useEffect(() => {
        setPrompt(initialPrompt);
        setDirty(false);
    }, [initialPrompt, revision?.id, shot.id]);

    const confirmPrompt = async () => {
        const normalized = normalizePrompt(prompt, context.mentionReferences);
        if (!normalized.trim()) {
            message.error("视频提示词不能为空");
            return;
        }
        setSaving(true);
        try {
            await onSave(shot, normalized, "draft");
            setPrompt(normalized);
            setDirty(false);
            message.success("本镜视频提示词已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "本镜提示词保存失败");
        } finally {
            setSaving(false);
        }
    };

    const insertReference = (reference: typeof context.mentionReferences[number]) => {
        const token = canvasResourceMentionToken(reference);
        const start = Math.min(selection.start, prompt.length);
        const end = Math.min(selection.end, prompt.length);
        const nextPrompt = `${prompt.slice(0, start)}${token}${prompt.slice(end)}`;
        setPrompt(nextPrompt);
        setDirty(nextPrompt !== initialPrompt);
        const offset = start + token.length;
        setSelection({ start: offset, end: offset });
        setCaretRequest({ offset, key: Date.now() });
    };

    return (
        <article className={`grid gap-3 rounded-xl border bg-foreground/[.025] p-3 lg:grid-cols-[220px_minmax(0,1fr)_160px] ${ready ? "border-emerald-500/35" : "border-border/60"}`}>
            <div className="relative aspect-video self-start overflow-hidden rounded-lg border border-border/60 bg-foreground/[.04]">
                {artifact?.resourceId ? <img src={resourceThumbnailUrl(artifact.resourceId, 480)} alt={`${shot.title}分镜图`} className="h-full w-full object-contain" loading="lazy" decoding="async" /> : <span className="grid h-full place-items-center text-foreground/25"><ImageIcon className="size-7" /></span>}
            </div>

            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">镜头 {String(index + 1).padStart(2, "0")} · {shot.title || "未命名"}</strong>
                    <span className="text-[var(--fs-tiny)] text-foreground/42">计划 {formatDuration(shot.durationMs)} / 全片 {targetSeconds} 秒</span>
                    <span className={`rounded px-1.5 py-0.5 text-[var(--fs-micro)] ${dirty ? "bg-amber-500/10 text-amber-500" : ready ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{dirty ? "有修改" : "提示词已保存"}</span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                    <label className="text-[var(--fs-micro)] font-medium text-foreground/48">视频提示词与动作节拍（仅本镜）</label>
                    <span className={`text-[var(--fs-micro)] ${dirty ? "text-amber-500" : "text-foreground/30"}`}>{dirty ? "修改后点击保存" : "输入 @ 精确引用本镜资产图片"}</span>
                </div>
                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={context.mentionReferences}
                    onChange={(value) => {
                        setPrompt(value);
                        setDirty(value !== initialPrompt);
                    }}
                    onSelectionRangeChange={setSelection}
                    caretRequest={caretRequest}
                    sendOnEnter={false}
                    containerClassName="workflow-shot-mention-container mt-1"
                    className="thin-scrollbar workflow-shot-mention-editor"
                    placeholder={context.mentionReferences.length ? "描述本镜画面、动作、时间节拍和运镜；输入 @ 选择当前镜头绑定的资产图片" : "描述本镜画面、动作、时间节拍和运镜；先在镜头资产中绑定角色或场景，才能用 @ 精确引用"}
                    aria-label="本镜视频提示词，可使用 @ 引用当前镜头绑定的资产图片"
                />

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[var(--fs-micro)] text-foreground/38">本镜可引用（点击插入光标位置）：</span>
                    {context.mentionReferences.length ? context.mentionReferences.map((reference) => (
                        <button key={reference.id} type="button" className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/50 px-1.5 py-0.5 text-[var(--fs-micro)] text-foreground/60 transition-colors hover:border-foreground/25 hover:text-foreground" title={`在光标处插入 @${reference.title || reference.label}`} onClick={() => insertReference(reference)}>
                            {reference.previewUrl ? <img src={reference.previewUrl} alt="" className="size-4 rounded-full object-cover" /> : <ImageIcon className="size-3" />}
                            <span className="max-w-32 truncate">@{reference.title || reference.label}</span>
                        </button>
                    )) : <span className="inline-flex items-center gap-1 text-[var(--fs-micro)] text-amber-500"><AlertTriangle className="size-3" />未绑定资产，请先到“角色与资产”绑定</span>}
                </div>
            </div>

            <div className="flex flex-col items-stretch justify-between gap-2 lg:items-end">
                <ArtifactStatus artifact={artifact} />
                <Button type={dirty ? "primary" : "default"} icon={<Save className="size-3.5" />} loading={saving} disabled={busy || !dirty || !ready} onClick={() => void confirmPrompt()}>{dirty ? "保存提示词" : "提示词已保存"}</Button>
            </div>
        </article>
    );
}

function normalizePrompt(prompt: string, references: ReturnType<typeof buildShotAssetReferenceContext>["mentionReferences"]) {
    return ensureShotAssetMentionPrompt(autoMentionShotAssetReferences(prompt.trim(), references), references);
}

function combineVideoPromptAndAction(videoPrompt: string, action: string) {
    const prompt = videoPrompt.trim();
    const beats = action.trim();
    if (!beats || prompt.includes(beats)) return prompt;
    return `${prompt}\n\n动作与时间节拍：\n${beats}`;
}

function PromptBlock({ label, value }: { label: string; value: string }) {
    return <div className="rounded-lg border border-border/60 bg-foreground/[.02] px-2.5 py-2"><div className="text-[var(--fs-micro)] font-medium text-foreground/38">{label}</div><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/58">{value}</p></div>;
}

function latestStoryboardTask(tasks: GenerationTask[], shotId: string) {
    return tasks
        .filter((task) => task.clientContext?.shotId === shotId && task.clientContext?.artifactType === "storyboard")
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function projectAssetThumbnailUrl(asset: ProjectDetail["assets"][number]) {
    const representation = asset.character?.representations?.find((item) => item.role === "turnaround_sheet")
        || asset.character?.representations?.find((item) => item.role === "primary")
        || asset.character?.representations?.find((item) => item.mediaType.startsWith("image"));
    const resourceId = representation?.resourceId || resourceIdFromStorageKey(asset.storageKey || "");
    return resourceId ? resourceThumbnailUrl(resourceId, 96) : "";
}
