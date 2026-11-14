import { useEffect, useMemo, useState } from "react";
import { App, Button, Checkbox, Input, Tag } from "antd";
import { ArrowLeft, CheckCircle2, Clapperboard, Edit3, Layers3, LoaderCircle, Play, RefreshCcw, Sparkles, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { resolveProjectCanvasStyle } from "@/components/canvas/canvas-style-picker-modal";
import {
    checkpointSmartFilmProductionRun,
    confirmSmartFilmBatchScripts,
    deleteSmartFilmBatchScript,
    getSmartFilmBatch,
    saveSmartFilmBatchScripts,
    startSmartFilmProductionStage,
    updateSmartFilmBatchScript,
    type SmartFilmBatch,
    type SmartFilmProductionRun,
    type SmartFilmScript,
    type SmartFilmScriptStatus,
} from "@/services/api/smart-film-batches";
import { getProject, getProjectCore, listProjectAssetCandidates, replaceProjectUnitShots, updateProjectUnit } from "@/services/api/projects";
import { chapterStoryboardAssets, chapterStoryboardCharacters, storyboardRowsToProjectShots } from "@/pages/projects/detail/chapter-storyboard-production";
import { generateChapterStoryboard } from "@/pages/projects/detail/project-chapter-ai";
import { useAssetStore } from "@/stores/use-asset-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { generateSmartFilmScripts } from "./smart-film-script-generation";

import "./smart-film.css";
import "./smart-film-batch.css";

const statusCopy: Record<SmartFilmScriptStatus, string> = {
    draft: "剧本草稿",
    project_created: "项目已创建",
    assets_extracted: "资产待确认",
    storyboard_ready: "分镜已生成",
    needs_attention: "需要处理",
    failed: "生成失败",
};

const stageStatusCopy: Record<"pending" | "waiting" | "queued" | "running" | "ready" | "needs_attention", string> = {
    pending: "待处理",
    waiting: "待启动",
    queued: "已入队",
    running: "进行中",
    ready: "已完成",
    needs_attention: "需要处理",
};

type ProductionCheckpointInput = Parameters<typeof checkpointSmartFilmProductionRun>[2];

export default function SmartFilmBatchDetailPage() {
    const { batchId = "" } = useParams();
    const navigate = useNavigate();
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const effectiveConfig = useEffectiveConfig();
    const assets = useAssetStore((state) => state.assets);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [editing, setEditing] = useState<SmartFilmScript | null>(null);
    const [draftTitle, setDraftTitle] = useState("");
    const [draftContent, setDraftContent] = useState("");
    const [busy, setBusy] = useState("");
    const batchQuery = useQuery({
        queryKey: ["smart-film-batch", batchId],
        queryFn: ({ signal }) => getSmartFilmBatch(batchId, signal).then((result) => result.batch),
        enabled: Boolean(batchId),
        refetchInterval: (query) => query.state.data?.productionRuns?.some((run) => run.assetStatus === "queued" || run.assetStatus === "running") ? 3000 : false,
    });
    const batch = batchQuery.data;
    const productAssets = useMemo(() => (batch?.inputAssetIds || []).flatMap((id) => {
        const asset = assets.find((item) => item.id === id && item.kind === "image");
        return asset ? [asset] : [];
    }), [assets, batch?.inputAssetIds]);
    const draftScripts = batch?.scripts.filter((script) => !script.projectId) || [];
    const projectScripts = batch?.scripts.filter((script) => Boolean(script.projectId)) || [];
    const runsByScript = useMemo(() => new Map<string, SmartFilmProductionRun>((batch?.productionRuns || []).map((run) => [run.scriptId, run])), [batch?.productionRuns]);
    const assetExtractionScripts = projectScripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return script.status === "project_created" && run?.assetStatus !== "queued" && run?.assetStatus !== "running";
    });
    const storyboardGenerationScripts = projectScripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return script.status === "assets_extracted" && run?.storyboardStatus !== "queued" && run?.storyboardStatus !== "running";
    });
    const recoverableScripts = batch?.scripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return Boolean(script.projectId && !script.unitId)
            || script.status === "needs_attention"
            || script.status === "failed"
            || run?.status === "needs_attention"
            || run?.status === "failed";
    }) || [];

    const checkpointProduction = async (script: SmartFilmScript, input: ProductionCheckpointInput) => {
        if (!batch) return;
        const run = runsByScript.get(script.id);
        if (!run) return;
        await checkpointSmartFilmProductionRun(batch.id, run.id, input);
    };

    useEffect(() => {
        if (!batch) return;
        setSelected((current) => {
            const available = new Set(batch.scripts.filter((script) => !script.projectId).map((script) => script.id));
            const next = new Set([...current].filter((id) => available.has(id)));
            if (!next.size && available.size) available.forEach((id) => next.add(id));
            return next;
        });
    }, [batch]);

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["smart-film-batch", batchId] });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
    };

    const updateBatch = (next: SmartFilmBatch) => {
        queryClient.setQueryData(["smart-film-batch", batchId], next);
    };

    const generateMissingScripts = async () => {
        if (!batch || busy) return;
        setBusy("正在生成剧本候选…");
        try {
            const generated = await generateSmartFilmScripts({
                idea: batch.sourceText,
                productTitles: productAssets.map((asset) => asset.title),
                count: Math.max(1, batch.config.scriptCount || 3),
                shotCount: batch.config.shotCount,
                shotDurationSeconds: batch.config.shotDurationSeconds,
                config: modelConfig(batch, effectiveConfig),
                batchId: batch.id,
                existingTitles: batch.scripts.map((script) => script.title),
            });
            const result = await saveSmartFilmBatchScripts(batch.id, generated.scripts.map((script) => ({
                title: script.title,
                content: script.content,
                taskId: generated.taskId,
            })), batch.revision);
            updateBatch(result.batch);
            message.success(`已生成 ${generated.scripts.length} 条独立剧本`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "剧本生成失败");
        } finally {
            setBusy("");
        }
    };

    const regenerateScript = async (script: SmartFilmScript) => {
        if (!batch || busy || script.projectId) return;
        setBusy(`正在重新生成「${script.title}」…`);
        try {
            const index = batch.scripts.findIndex((item) => item.id === script.id) + 1;
            const generated = await generateSmartFilmScripts({
                idea: batch.sourceText,
                productTitles: productAssets.map((asset) => asset.title),
                count: 1,
                shotCount: batch.config.shotCount,
                shotDurationSeconds: batch.config.shotDurationSeconds,
                config: modelConfig(batch, effectiveConfig),
                batchId: batch.id,
                existingTitles: batch.scripts.filter((item) => item.id !== script.id).map((item) => item.title),
                regenerateIndex: index,
            });
            const next = generated.scripts[0];
            if (!next) throw new Error("模型没有返回有效剧本");
            const result = await updateSmartFilmBatchScript(batch.id, script.id, {
                title: next.title,
                content: next.content,
                status: "draft",
                taskId: generated.taskId,
                expectedRevision: batch.revision,
            });
            updateBatch(result.batch);
            message.success("剧本已重新生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重新生成失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const openEditor = (script: SmartFilmScript) => {
        setEditing(script);
        setDraftTitle(script.title);
        setDraftContent(script.content);
    };

    const saveEditor = async () => {
        if (!batch || !editing || busy) return;
        setBusy("正在保存剧本…");
        try {
            if (editing.projectId && editing.unitId) {
                await updateProjectUnit(editing.projectId, editing.unitId, { title: draftTitle, sourceText: draftContent });
            }
            const result = await updateSmartFilmBatchScript(batch.id, editing.id, {
                title: draftTitle,
                content: draftContent,
                status: editing.projectId ? "project_created" : "draft",
                expectedRevision: batch.revision,
            });
            updateBatch(result.batch);
            setEditing(null);
            message.success("剧本已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const deleteScript = async (script: SmartFilmScript) => {
        if (!batch || busy || script.projectId) return;
        modal.confirm({
            title: `删除剧本「${script.title}」？`,
            content: "只删除这条剧本草稿，不会影响其他独立视频。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                setBusy("正在删除剧本…");
                try {
                    const result = await deleteSmartFilmBatchScript(batch.id, script.id, batch.revision);
                    updateBatch(result.batch);
                    message.success("剧本已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "删除失败");
                    await refresh();
                } finally {
                    setBusy("");
                }
            },
        });
    };

    const confirmSelected = async () => {
        if (!batch || busy) return;
        const scriptIds = [...selected].filter((id) => batch.scripts.some((script) => script.id === id && !script.projectId));
        if (!scriptIds.length) return message.warning("请先选择要制作的剧本");
        modal.confirm({
            title: `为 ${scriptIds.length} 条剧本分别创建独立视频项目？`,
            content: "每条剧本会创建自己的项目、资产、分镜、任务和视频产物，不会合并成一条视频。",
            okText: "创建独立视频项目",
            cancelText: "取消",
            onOk: async () => {
                setBusy("正在创建独立视频项目…");
                try {
                    const result = await confirmSmartFilmBatchScripts(batch.id, scriptIds, batch.revision);
                    updateBatch(result.batch);
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    message.success(`已创建 ${scriptIds.length} 个独立视频项目`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "创建视频项目失败");
                    await refresh();
                } finally {
                    setBusy("");
                }
            },
        });
    };

    const retryFailedRuns = async () => {
        if (!batch || busy || !recoverableScripts.length) return;
        setBusy(`正在恢复 ${recoverableScripts.length} 条剧本的创建任务…`);
        try {
            const result = await confirmSmartFilmBatchScripts(batch.id, recoverableScripts.map((script) => script.id), batch.revision);
            updateBatch(result.batch);
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("批次创建已恢复");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批次恢复失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const extractProjectAssets = async (script: SmartFilmScript) => {
        if (!batch || busy || !script.projectId || !script.unitId) return;
        setBusy(`正在为「${script.title}」提取资产…`);
        try {
            const run = runsByScript.get(script.id);
            if (!run) throw new Error("这条剧本还没有生产运行记录，请先修复批次创建");
            await startSmartFilmProductionStage(batch.id, run.id, "assets");
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            message.success(`「${script.title}」资产提取已进入后台队列`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "资产提取失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const extractPendingProjectAssets = async () => {
        if (!batch || busy || !assetExtractionScripts.length) return;
        modal.confirm({
            title: `为 ${assetExtractionScripts.length} 个独立项目提取资产候选？`,
            content: "每个项目会分别提取角色、场景和道具候选。提取完成后需要先确认资产，再生成分镜。",
            okText: "开始提取",
            cancelText: "取消",
            onOk: async () => {
                setBusy(`正在提取 ${assetExtractionScripts.length} 个独立项目的资产…`);
                const failures: string[] = [];
                try {
                    for (const script of assetExtractionScripts) {
                        try {
                            const run = runsByScript.get(script.id);
                            if (!run) throw new Error("缺少生产运行记录");
                            await startSmartFilmProductionStage(batch.id, run.id, "assets");
                        } catch (error) {
                            failures.push(`${script.title}：${error instanceof Error ? error.message : "提取失败"}`);
                        }
                    }
                    const latest = await getSmartFilmBatch(batch.id);
                    updateBatch(latest.batch);
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    if (failures.length) message.warning(`${assetExtractionScripts.length - failures.length} 个已入队，${failures.length} 个失败：${failures.slice(0, 3).join("；")}`);
                    else message.success("所有独立项目的资产提取已进入后台队列");
                } finally {
                    setBusy("");
                }
            },
        });
    };

    const generateProjectStoryboard = async (script: SmartFilmScript) => {
        if (!batch || busy || !script.projectId || !script.unitId) return;
        setBusy(`正在为「${script.title}」生成分镜…`);
        try {
            const result = await listProjectAssetCandidates(script.projectId, { status: "pending_confirmation", pageSize: 1 });
            if (result.total > 0) {
                message.warning(`还有 ${result.total} 个资产待确认，请先确认资产再生成分镜`);
                navigate(`/projects/${script.projectId}/workflow/${script.unitId}/assets`);
                return;
            }
            await checkpointProduction(script, { stage: "storyboard", status: "running" });
            const generated = await generateIndependentProjectStoryboard(batch, script, effectiveConfig);
            await checkpointProduction(script, { stage: "storyboard", status: "ready", taskId: generated.taskId, resourceCount: generated.shotCount });
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            await queryClient.invalidateQueries({ queryKey: ["project", script.projectId] });
            message.success(`「${script.title}」分镜已生成，请进入项目确认提示词`);
            navigate(`/projects/${script.projectId}/workflow/${script.unitId}/storyboard`);
        } catch (error) {
            await checkpointProduction(script, { stage: "storyboard", status: "needs_attention", error: error instanceof Error ? error.message : "分镜生成失败" }).catch(() => undefined);
            message.error(error instanceof Error ? error.message : "分镜生成失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const generatePendingStoryboards = async () => {
        if (!batch || busy || !storyboardGenerationScripts.length) return;
        modal.confirm({
            title: `为 ${storyboardGenerationScripts.length} 个独立项目生成分镜？`,
            content: "只有资产已确认的项目才会开始生成。仍有待确认资产的项目会跳过，不会自动确认资产。",
            okText: "开始生成",
            cancelText: "取消",
            onOk: async () => {
                setBusy(`正在生成 ${storyboardGenerationScripts.length} 个独立项目的分镜…`);
                const failures: string[] = [];
                try {
                    for (const script of storyboardGenerationScripts) {
                        try {
                            const result = await listProjectAssetCandidates(script.projectId!, { status: "pending_confirmation", pageSize: 1 });
                            if (result.total > 0) throw new Error(`还有 ${result.total} 个资产待确认`);
                            await checkpointProduction(script, { stage: "storyboard", status: "running" });
                            const generated = await generateIndependentProjectStoryboard(batch, script, effectiveConfig);
                            await checkpointProduction(script, { stage: "storyboard", status: "ready", taskId: generated.taskId, resourceCount: generated.shotCount });
                        } catch (error) {
                            await checkpointProduction(script, { stage: "storyboard", status: "needs_attention", error: error instanceof Error ? error.message : "生成失败" }).catch(() => undefined);
                            failures.push(`${script.title}：${error instanceof Error ? error.message : "生成失败"}`);
                        }
                    }
                    const latest = await getSmartFilmBatch(batch.id);
                    updateBatch(latest.batch);
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    if (failures.length) message.warning(`${storyboardGenerationScripts.length - failures.length} 个成功，${failures.length} 个失败：${failures.slice(0, 3).join("；")}`);
                    else message.success("所有已确认资产的项目分镜已生成");
                } finally {
                    setBusy("");
                }
            },
        });
    };

    const toggle = (id: string, checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(id); else next.delete(id);
            return next;
        });
    };

    if (batchQuery.isLoading) {
        return <WorkspacePage className="smart-film-page"><div className="smart-film-generating"><LoaderCircle className="size-7 animate-spin" /><strong>正在读取多剧本批次…</strong></div></WorkspacePage>;
    }
    if (!batch) {
        return <WorkspacePage className="smart-film-page"><div className="smart-film-script-empty"><strong>没有找到这个批次</strong><span>它可能已被删除，或者不属于当前账号。</span><Button onClick={() => navigate("/smart-film")}>返回智能成片</Button></div></WorkspacePage>;
    }

    return (
        <WorkspacePage className="smart-film-page smart-film-batch-page">
            <header className="smart-film-hero">
                <div>
                    <span className="smart-film-eyebrow"><Clapperboard className="size-3.5" /> INDEPENDENT FILMS</span>
                    <h1>{batch.title}</h1>
                    <p>{batch.sourceText}</p>
                </div>
                <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/smart-film")}>返回智能成片</Button>
            </header>

            <div className="smart-film-batch-detail">
                <section className="smart-film-batch-summary">
                    <div>
                        <h2>每条剧本都是独立视频</h2>
                        <p>{busy || "选择剧本后分别创建项目。每个项目拥有自己的资产确认、分镜提示词、任务、计费和最终视频。"}</p>
                    </div>
                    <div className="smart-film-batch-summary-stats">
                        <div><span>剧本</span><strong>{batch.scripts.length}</strong></div>
                        <div><span>已建项目</span><strong>{projectScripts.length}</strong></div>
                        <div><span>产品图</span><strong>{batch.inputAssetIds.length}</strong></div>
                    </div>
                </section>

                <div className="smart-film-batch-toolbar">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={Boolean(draftScripts.length) && draftScripts.every((script) => selected.has(script.id))}
                            indeterminate={draftScripts.some((script) => selected.has(script.id)) && !draftScripts.every((script) => selected.has(script.id))}
                            onChange={(event) => setSelected(event.target.checked ? new Set(draftScripts.map((script) => script.id)) : new Set())}
                        >选择全部剧本草稿</Checkbox>
                        <span className="text-xs text-foreground/45">已选 {selected.size} 条</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {!batch.scripts.length ? <Button icon={<Sparkles className="size-4" />} loading={Boolean(busy)} onClick={() => void generateMissingScripts()}>生成剧本</Button> : null}
                        {recoverableScripts.length ? <Button danger icon={<RefreshCcw className="size-4" />} disabled={Boolean(busy)} onClick={() => void retryFailedRuns()}>修复批次创建（{recoverableScripts.length}）</Button> : null}
                        {assetExtractionScripts.length ? <Button icon={<Layers3 className="size-4" />} disabled={Boolean(busy)} onClick={() => void extractPendingProjectAssets()}>提取资产（{assetExtractionScripts.length}）</Button> : null}
                        {storyboardGenerationScripts.length ? <Button icon={<Clapperboard className="size-4" />} disabled={Boolean(busy)} onClick={() => void generatePendingStoryboards()}>生成分镜（{storyboardGenerationScripts.length}）</Button> : null}
                        <Button type="primary" icon={<Play className="size-4" />} disabled={!selected.size || Boolean(busy)} onClick={() => void confirmSelected()}>创建独立视频项目</Button>
                    </div>
                </div>

                {batch.scripts.length ? (
                    <div className="smart-film-script-list">
                        {batch.scripts.map((script, index) => (
                            <article className={`smart-film-script-card${selected.has(script.id) ? " is-selected" : ""}`} key={script.id}>
                                <div className="smart-film-script-check">
                                    <Checkbox checked={selected.has(script.id)} disabled={Boolean(script.projectId) || Boolean(busy)} onChange={(event) => toggle(script.id, event.target.checked)} />
                                </div>
                                <div className="smart-film-script-copy">
                                    <header>
                                        <span className="text-xs font-mono text-foreground/35">SCRIPT {String(index + 1).padStart(2, "0")}</span>
                                        <h3>{script.title}</h3>
                                        <Tag color={scriptStatusColor(script.status)}>{statusCopy[script.status] || script.status}</Tag>
                                    </header>
                                    <p>{script.content}</p>
                                    {runsByScript.get(script.id) ? (
                                        <div className="mt-2 flex flex-wrap items-center gap-1">
                                            <Tag bordered={false}>资产提取：{stageStatusCopy[runsByScript.get(script.id)!.assetStatus]}{runsByScript.get(script.id)!.assetCount ? ` · ${runsByScript.get(script.id)!.assetCount} 个` : ""}</Tag>
                                            <Tag bordered={false}>分镜生成：{stageStatusCopy[runsByScript.get(script.id)!.storyboardStatus]}{runsByScript.get(script.id)!.storyboardShotCount ? ` · ${runsByScript.get(script.id)!.storyboardShotCount} 镜` : ""}</Tag>
                                        </div>
                                    ) : null}
                                    {script.error || runsByScript.get(script.id)?.error ? (
                                        <div className="smart-film-script-error">
                                            {script.error || `创建中断（${runsByScript.get(script.id)?.failedStep || "未知步骤"}）：${runsByScript.get(script.id)?.error}`}
                                        </div>
                                    ) : null}
                                </div>
                                <div className="smart-film-script-actions">
                                    <Button size="small" icon={<Edit3 className="size-3.5" />} onClick={() => openEditor(script)}>修改</Button>
                                    {!script.projectId ? <Button size="small" icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void regenerateScript(script)}>重新生成</Button> : null}
                                    {!script.projectId ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void deleteScript(script)}>删除</Button> : null}
                                    {script.projectId && script.unitId ? (
                                        <>
                                            {script.status === "project_created" ? (
                                                runsByScript.get(script.id)?.assetStatus === "queued" || runsByScript.get(script.id)?.assetStatus === "running"
                                                    ? <Button size="small" loading disabled>资产提取中</Button>
                                                    : <Button size="small" icon={<Layers3 className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void extractProjectAssets(script)}>提取资产</Button>
                                            ) : null}
                                            {script.status === "assets_extracted" ? (
                                                runsByScript.get(script.id)?.storyboardStatus === "queued" || runsByScript.get(script.id)?.storyboardStatus === "running"
                                                    ? <Button size="small" loading disabled>分镜生成中</Button>
                                                    : <Button size="small" icon={<Sparkles className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void generateProjectStoryboard(script)}>生成分镜</Button>
                                            ) : null}
                                            <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/workflow/${script.unitId}/${script.status === "storyboard_ready" ? "storyboard" : "assets"}`)}>打开项目</Button>
                                        </>
                                    ) : null}
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <div className="smart-film-script-empty">
                        <Sparkles className="size-7 text-foreground/30" />
                        <strong>这个批次还没有剧本</strong>
                        <span>上次生成可能中断了。可以按同一组想法和产品图重新生成 {batch.config.scriptCount} 条独立剧本。</span>
                        <Button type="primary" loading={Boolean(busy)} onClick={() => void generateMissingScripts()}>重新生成剧本</Button>
                    </div>
                )}
            </div>
            {editing ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-3xl rounded-2xl border border-border bg-background p-5 shadow-2xl">
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <div><strong className="text-base">修改独立剧本</strong><p className="mt-1 text-xs text-foreground/45">只修改当前这条剧本，不会影响其他独立视频。</p></div>
                            <Button onClick={() => setEditing(null)}>关闭</Button>
                        </div>
                        <Input value={draftTitle} maxLength={120} onChange={(event) => setDraftTitle(event.target.value)} placeholder="剧本标题" />
                        <Input.TextArea className="mt-3" value={draftContent} onChange={(event) => setDraftContent(event.target.value)} autoSize={{ minRows: 12, maxRows: 24 }} placeholder="剧本正文" />
                        <div className="mt-4 flex justify-end gap-2"><Button onClick={() => setEditing(null)}>取消</Button><Button type="primary" loading={Boolean(busy)} onClick={() => void saveEditor()}>保存剧本</Button></div>
                    </div>
                </div>
            ) : null}
        </WorkspacePage>
    );
}

function modelConfig(batch: SmartFilmBatch, effectiveConfig: ReturnType<typeof useEffectiveConfig>) {
    const textModel = batch.config.defaultTextModel || effectiveConfig.textModel;
    return { ...effectiveConfig, model: textModel, textModel, imageModel: batch.config.defaultImageModel || effectiveConfig.imageModel, videoModel: batch.config.defaultVideoModel || effectiveConfig.videoModel };
}

async function generateIndependentProjectStoryboard(batch: SmartFilmBatch, script: SmartFilmScript, effectiveConfig: ReturnType<typeof useEffectiveConfig>) {
    if (!script.projectId || !script.unitId) throw new Error("剧本还没有独立视频项目");
    const detail = await getProject(script.projectId);
    const style = resolveProjectCanvasStyle(detail.project.stylePresetId, detail.project.styleProfileJson);
    const config = modelConfig(batch, effectiveConfig);
    const textModel = config.textModel || config.model;
    const core = await getProjectCore(script.projectId);
    const approvedRevision = core.project.revision;
    const durations = batch.config.shotDurationsSeconds?.length
        ? batch.config.shotDurationsSeconds
        : Array.from({ length: batch.config.shotCount }, () => batch.config.shotDurationSeconds);
    const generated = await generateChapterStoryboard({
        projectId: script.projectId,
        chapterId: script.unitId,
        chapterTitle: script.title,
        sourceText: script.content,
        projectStyle: { presetId: style?.id || "", title: style?.title || "", prompt: style?.prompt || "", profileJson: detail.project.styleProfileJson },
        characters: chapterStoryboardCharacters(detail, script.unitId),
        assets: chapterStoryboardAssets(detail),
        config: { ...config, model: textModel, textModel },
        skills: [],
        selectedSkillIds: [],
        approvedRevision,
        approvedShotIds: [],
        shotCount: batch.config.shotCount,
        shotDurationsSeconds: durations,
        userRequirements: "这是多剧本批次中的一个独立视频项目。只根据本条剧本制作，不要引用其他剧本的内容。",
    });
    if (!generated.rows.length) throw new Error("模型没有返回有效分镜");
    const productAssetIDs = new Set(batch.inputAssetIds);
    const productAssets = detail.assets.filter((asset) => productAssetIDs.has(asset.id) && asset.primaryVersionId && asset.mediaType === "image");
    const productVersionIds = productAssets.map((asset) => asset.primaryVersionId).filter((id): id is string => Boolean(id)).slice(0, 6);
    const productMentions = productAssets.map((asset) => `@[asset:${asset.id}]`).join(" ");
    const shots = storyboardRowsToProjectShots(generated.rows.slice(0, batch.config.shotCount), detail).map((shot, index) => {
        const durationSeconds = durations[index] ?? batch.config.shotDurationSeconds;
        const durationMs = Math.round(durationSeconds * 1000);
        const withProductMentions = (value: string | undefined) => value?.includes("@[asset:") ? value : [value, productMentions].filter(Boolean).join("\n\n");
        return {
            ...shot,
            durationMs,
            assetVersionIds: shot.assetVersionIds?.length ? shot.assetVersionIds : productVersionIds,
            revision: {
                ...shot.revision,
                durationMs,
                imagePrompt: withProductMentions(shot.revision?.imagePrompt),
                videoPrompt: withProductMentions(shot.revision?.videoPrompt),
            },
        };
    });
    await replaceProjectUnitShots(script.projectId, script.unitId, shots, [], approvedRevision, { sourceTaskId: generated.taskId });
    await updateSmartFilmBatchScript(batch.id, script.id, {
        title: script.title,
        content: script.content,
        status: "storyboard_ready",
        expectedRevision: (await getSmartFilmBatch(batch.id)).batch.revision,
    });
    return { taskId: generated.taskId, shotCount: shots.length };
}

function scriptStatusColor(status: SmartFilmScriptStatus) {
    if (status === "storyboard_ready") return "green";
    if (status === "assets_extracted") return "cyan";
    if (status === "project_created") return "blue";
    if (status === "needs_attention" || status === "failed") return "red";
    return "default";
}
