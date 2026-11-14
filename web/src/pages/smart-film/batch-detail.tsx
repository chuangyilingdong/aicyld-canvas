import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Input, InputNumber, Tag } from "antd";
import { ArrowLeft, CheckCircle2, Clapperboard, Edit3, Layers3, LoaderCircle, Pause, Play, RefreshCcw, SkipForward, Sparkles, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { resolveCanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { parseStyleProfile } from "@/lib/canvas/style-profile";
import {
    controlSmartFilmBatch,
    controlSmartFilmProductionRun,
    confirmSmartFilmBatchScripts,
    deleteSmartFilmBatchScript,
    getSmartFilmBatch,
    getSmartFilmBatchCosts,
    saveSmartFilmBatchScripts,
    startSmartFilmProductionStage,
    updateSmartFilmBatchBudget,
    updateSmartFilmBatchScript,
    type SmartFilmBatch,
    type SmartFilmProductionRun,
    type SmartFilmScript,
    type SmartFilmScriptStatus,
} from "@/services/api/smart-film-batches";
import { listProjectAssetCandidates, updateProjectUnit } from "@/services/api/projects";
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

const stageStatusCopy: Record<"pending" | "waiting" | "queued" | "running" | "ready" | "confirmed" | "needs_attention", string> = {
    pending: "待处理",
    waiting: "待启动",
    queued: "已入队",
    running: "进行中",
    ready: "已完成",
    confirmed: "已确认",
    needs_attention: "需要处理",
};

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
    const [budgetDraft, setBudgetDraft] = useState<number | null>(0);
    const budgetSourceRef = useRef(-1);
    const batchQuery = useQuery({
        queryKey: ["smart-film-batch", batchId],
        queryFn: ({ signal }) => getSmartFilmBatch(batchId, signal).then((result) => result.batch),
        enabled: Boolean(batchId),
        refetchInterval: (query) => query.state.data?.productionRuns?.some((run) => ["queued", "running"].includes(run.assetStatus) || ["queued", "running"].includes(run.storyboardStatus)) ? 3000 : false,
    });
    const costsQuery = useQuery({
        queryKey: ["smart-film-batch-costs", batchId],
        queryFn: () => getSmartFilmBatchCosts(batchId),
        enabled: Boolean(batchId),
    });
    const batch = batchQuery.data;
    const costs = costsQuery.data;
    const batchSpec = useMemo(() => {
        if (!batch) return "";
        const durations = batch.config.shotDurationsSeconds?.length
            ? batch.config.shotDurationsSeconds
            : Array.from({ length: batch.config.shotCount }, () => batch.config.shotDurationSeconds);
        const durationCopy = durations.every((duration) => duration === durations[0])
            ? `${batch.config.shotCount} 镜 × ${durations[0] || batch.config.shotDurationSeconds} 秒`
            : `逐镜 ${durations.join(" / ")} 秒`;
        const styleTitle = parseStyleProfile(batch.config.styleProfileJson)?.title
            || resolveCanvasStylePreset(batch.config.stylePresetId || "")?.title
            || (batch.config.stylePresetId ? "自定义画风" : "未设置画风");
        return `画幅 ${batch.config.aspectRatio} · ${durationCopy} · ${styleTitle}`;
    }, [batch]);
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

    useEffect(() => {
        if (!batch) return;
        if (budgetSourceRef.current !== batch.budgetPoints) {
            budgetSourceRef.current = batch.budgetPoints;
            setBudgetDraft(batch.budgetPoints || 0);
        }
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

    const saveBudget = async () => {
        if (!batch || busy) return;
        setBusy("正在保存批次预算…");
        try {
            const result = await updateSmartFilmBatchBudget(batch.id, Math.max(0, Math.floor(Number(budgetDraft) || 0)));
            updateBatch(result.batch);
            await queryClient.invalidateQueries({ queryKey: ["smart-film-batch-costs", batch.id] });
            message.success("批次预算已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存预算失败");
        } finally {
            setBusy("");
        }
    };

    const ensureBudgetAvailable = async () => {
        if (!batch || !batch.budgetPoints) return;
        const latest = await getSmartFilmBatchCosts(batch.id);
        queryClient.setQueryData(["smart-film-batch-costs", batch.id], latest);
        if (latest.overBudget) {
            throw new Error(`批次预计需要 ${latest.totalPoints} 积分，已超过预算 ${latest.budgetPoints} 积分`);
        }
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
            await ensureBudgetAvailable();
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
                    await ensureBudgetAvailable();
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
        setBusy(`正在为「${script.title}」分镜入队…`);
        try {
            await ensureBudgetAvailable();
            const result = await listProjectAssetCandidates(script.projectId, { status: "pending_confirmation", pageSize: 1 });
            if (result.total > 0) {
                message.warning(`还有 ${result.total} 个资产待确认，请先确认资产再生成分镜`);
                navigate(`/projects/${script.projectId}/workflow/${script.unitId}/assets`);
                return;
            }
            const run = runsByScript.get(script.id);
            if (!run) throw new Error("缺少生产运行记录");
            await startSmartFilmProductionStage(batch.id, run.id, "storyboard");
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            message.success(`「${script.title}」分镜已进入后台队列`);
        } catch (error) {
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
            content: "只有资产已确认的项目才会进入后台队列。仍有待确认资产的项目会跳过，不会自动确认资产。",
            okText: "开始入队",
            cancelText: "取消",
            onOk: async () => {
                setBusy(`正在为 ${storyboardGenerationScripts.length} 个独立项目分镜入队…`);
                const failures: string[] = [];
                try {
                    await ensureBudgetAvailable();
                    for (const script of storyboardGenerationScripts) {
                        try {
                            const result = await listProjectAssetCandidates(script.projectId!, { status: "pending_confirmation", pageSize: 1 });
                            if (result.total > 0) throw new Error(`还有 ${result.total} 个资产待确认`);
                            const run = runsByScript.get(script.id);
                            if (!run) throw new Error("缺少生产运行记录");
                            await startSmartFilmProductionStage(batch.id, run.id, "storyboard");
                        } catch (error) {
                            failures.push(`${script.title}：${error instanceof Error ? error.message : "生成失败"}`);
                        }
                    }
                    const latest = await getSmartFilmBatch(batch.id);
                    updateBatch(latest.batch);
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    if (failures.length) message.warning(`${storyboardGenerationScripts.length - failures.length} 个已入队，${failures.length} 个失败：${failures.slice(0, 3).join("；")}`);
                    else message.success("所有已确认资产的项目分镜已进入后台队列");
                } finally {
                    setBusy("");
                }
            },
        });
    };

    const toggleBatchPause = async () => {
        if (!batch || busy) return;
        setBusy(batch.paused ? "正在继续批次…" : "正在暂停批次…");
        try {
            const result = await controlSmartFilmBatch(batch.id, batch.paused ? "resume" : "pause");
            updateBatch(result.batch);
            message.success(result.batch.paused ? "批次已暂停" : "批次已继续");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批次控制失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const controlProject = async (script: SmartFilmScript, action: "pause" | "resume" | "skip") => {
        if (!batch || busy) return;
        const run = runsByScript.get(script.id);
        if (!run) return;
        setBusy(action === "skip" ? `正在跳过「${script.title}」…` : `正在更新「${script.title}」…`);
        try {
            await controlSmartFilmProductionRun(batch.id, run.id, action);
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            message.success(action === "skip" ? "项目已跳过" : action === "pause" ? "项目已暂停" : "项目已继续");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "项目控制失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const retryProject = async (script: SmartFilmScript) => {
        if (!batch || busy) return;
        const run = runsByScript.get(script.id);
        if (!run) return;
        const stage = run.failedStep === "assets" ? "assets" : "storyboard";
        setBusy(`正在重试「${script.title}」…`);
        try {
            await controlSmartFilmProductionRun(batch.id, run.id, "retry", stage);
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            message.success("失败阶段已重新进入后台队列");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重试失败");
            await refresh();
        } finally {
            setBusy("");
        }
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
                <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/smart-film/batches")}>返回批次列表</Button>
            </header>

            <div className="smart-film-batch-detail">
                <section className="smart-film-batch-summary">
                    <div>
                        <h2>每条剧本都是独立视频</h2>
                        <p>{busy || "选择剧本后分别创建项目。每个项目拥有自己的资产确认、分镜提示词、任务、计费和最终视频。"}</p>
                        <p>{batchSpec}</p>
                    </div>
                    <div className="smart-film-batch-summary-stats">
                        <div><span>剧本</span><strong>{batch.scripts.length}</strong></div>
                        <div><span>已建项目</span><strong>{projectScripts.length}</strong></div>
                        <div><span>产品图</span><strong>{batch.inputAssetIds.length}</strong></div>
                        <div><span>后台队列</span><strong>{batch.control.queuedCount + batch.control.runningCount}</strong></div>
                    </div>
                </section>

                <div className="smart-film-batch-control-strip">
                    <div>
                        <strong>{batch.paused ? "批次已暂停" : batch.control.currentProjectId ? "后台正在处理项目" : "等待后台调度"}</strong>
                        <span>{batch.control.currentProjectId ? `当前项目 ${batch.control.currentProjectId}` : `等待项目 ${batch.control.queuedCount} 个，运行中 ${batch.control.runningCount} 个`}</span>
                    </div>
                    <Button icon={batch.paused ? <Play className="size-4" /> : <Pause className="size-4" />} disabled={Boolean(busy)} onClick={() => void toggleBatchPause()}>{batch.paused ? "继续批次" : "暂停批次"}</Button>
                </div>

                <div className="smart-film-budget-panel">
                    <div className="smart-film-budget-stats">
                        <div><span>预算</span><strong>{batch.budgetPoints || "不限"}</strong></div>
                        <div><span>已占用</span><strong>{costs?.committedPoints ?? 0}</strong></div>
                        <div><span>预计剩余</span><strong>{costs?.estimatedPoints ?? 0}</strong></div>
                        <div><span>合计</span><strong>{costs?.totalPoints ?? 0}</strong></div>
                        <div><span>余额</span><strong>{costs?.enabled ? costs.balance : "—"}</strong></div>
                    </div>
                    <div className="smart-film-budget-actions">
                        <InputNumber min={0} precision={0} value={budgetDraft} onChange={setBudgetDraft} addonAfter="积分" />
                        <Button loading={Boolean(busy)} onClick={() => void saveBudget()}>保存预算</Button>
                    </div>
                    {costs?.overBudget ? <div className="smart-film-budget-over">当前预算不足以覆盖剩余计划，系统会阻止继续提交付费任务。</div> : null}
                    {!costs?.enabled && costs ? <div className="text-xs text-foreground/45">当前环境未启用积分计费，仅展示已占用记录。</div> : null}
                </div>

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
                                            {runsByScript.get(script.id)!.controlStatus === "paused" ? <Tag color="orange">项目已暂停</Tag> : null}
                                            {runsByScript.get(script.id)!.controlStatus === "skipped" ? <Tag>项目已跳过</Tag> : null}
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
                                            {runsByScript.get(script.id)?.controlStatus !== "skipped" ? (
                                                runsByScript.get(script.id)?.controlStatus === "paused"
                                                    ? <Button size="small" icon={<Play className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void controlProject(script, "resume")}>继续项目</Button>
                                                    : <Button size="small" icon={<Pause className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void controlProject(script, "pause")}>暂停项目</Button>
                                            ) : null}
                                            {runsByScript.get(script.id)?.controlStatus !== "skipped" ? <Button size="small" icon={<SkipForward className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void controlProject(script, "skip")}>跳过</Button> : null}
                                            {runsByScript.get(script.id)?.status === "needs_attention" || script.status === "needs_attention" ? <Button size="small" danger icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void retryProject(script)}>重试失败阶段</Button> : null}
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

function scriptStatusColor(status: SmartFilmScriptStatus) {
    if (status === "storyboard_ready") return "green";
    if (status === "assets_extracted") return "cyan";
    if (status === "project_created") return "blue";
    if (status === "needs_attention" || status === "failed") return "red";
    return "default";
}
