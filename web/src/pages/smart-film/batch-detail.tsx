import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Dropdown, Input, InputNumber, Select, Tag, type MenuProps } from "antd";
import { ArrowLeft, CheckCircle2, ChevronDown, Clapperboard, Columns3, Edit3, Layers3, LoaderCircle, Pause, Play, RefreshCcw, SkipForward, Sparkles, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { resolveCanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { parseStyleProfile } from "@/lib/canvas/style-profile";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { normalizeSmartFilmShotCount, resizeSmartFilmShotDurations, smartFilmDefaultShotSeconds, smartFilmDurationOptions, smartFilmMaxClipSeconds } from "@/lib/canvas/smart-film-options";
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
    updateSmartFilmBatchProductionConfig,
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
import { smartFilmRecoveryMessage, smartFilmRecoveryStage, type SmartFilmRecoveryMode } from "./smart-film-recovery";
import { batchBulkEligibility, bulkDialogCount, type SmartFilmBulkDialogKind } from "./batch-bulk-operations";
import { SmartFilmBatchBulkDialog, type SmartFilmBulkDialogValue } from "./batch-bulk-dialogs";
import { useSmartFilmBatchBulkActions } from "./use-smart-film-batch-bulk";
import { canCompareSmartFilmScripts } from "./smart-film-script-comparison";
import { SmartFilmScriptComparisonDialog } from "./smart-film-script-comparison-dialog";

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
    const [comparisonOpen, setComparisonOpen] = useState(false);
    const [bulkDialog, setBulkDialog] = useState<SmartFilmBulkDialogKind | "">("");
    const [editing, setEditing] = useState<SmartFilmScript | null>(null);
    const [draftTitle, setDraftTitle] = useState("");
    const [draftContent, setDraftContent] = useState("");
    const [busy, setBusy] = useState("");
    const [budgetDraft, setBudgetDraft] = useState<number | null>(0);
    const [productionModeDraft, setProductionModeDraft] = useState<"fixed" | "smart" | "">("");
    const [shotCountDraft, setShotCountDraft] = useState<number | null>(6);
    const [shotDurationsDraft, setShotDurationsDraft] = useState<number[]>([]);
    const [targetDurationDraft, setTargetDurationDraft] = useState<number | null>(30);
    const budgetSourceRef = useRef(-1);
    const productionSourceRef = useRef("");
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
    const resolvedProductionVideoModel = batch?.config.defaultVideoModel || effectiveConfig.videoModel;
    const productionVideoProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, resolvedProductionVideoModel).video, [effectiveConfig, resolvedProductionVideoModel]);
    const productionDurationOptions = useMemo(() => smartFilmDurationOptions(productionVideoProfile), [productionVideoProfile]);
    const productionDefaultShotSeconds = smartFilmDefaultShotSeconds(productionVideoProfile);
    const productionMaxClipSeconds = smartFilmMaxClipSeconds(productionVideoProfile);
    const productionMaxTargetSeconds = productionMaxClipSeconds;
    const normalizedDraftShotCount = normalizeSmartFilmShotCount(shotCountDraft);
    const productionConfigValid = productionModeDraft === "fixed"
        ? shotDurationsDraft.length === normalizedDraftShotCount && shotDurationsDraft.every((duration) => duration > 0 && duration <= productionMaxClipSeconds)
        : productionModeDraft === "smart"
            ? Number(targetDurationDraft) >= 1 && Number(targetDurationDraft) <= productionMaxTargetSeconds
            : false;
    const batchSpec = useMemo(() => {
        if (!batch) return "";
        const durationCopy = batch.config.productionMode === "smart"
            ? `智能整片 · 目标 ${batch.config.targetDurationSeconds || 0} 秒`
            : batch.config.productionMode === "fixed"
                ? (() => {
                      const durations = batch.config.shotDurationsSeconds?.length
                          ? batch.config.shotDurationsSeconds
                          : Array.from({ length: batch.config.shotCount || 0 }, () => batch.config.shotDurationSeconds || 0);
                      return durations.length && durations.every((duration) => duration === durations[0])
                          ? `${batch.config.shotCount} 镜 × ${durations[0]} 秒`
                          : `逐镜 ${durations.join(" / ")} 秒`;
                  })()
                : "分镜策略待设置";
        const styleTitle = parseStyleProfile(batch.config.styleProfileJson)?.title
            || resolveCanvasStylePreset(batch.config.stylePresetId || "")?.title
            || (batch.config.stylePresetId ? "自定义画风" : "未设置画风");
        return `画幅 ${batch.config.aspectRatio} · ${durationCopy} · ${styleTitle}`;
    }, [batch]);
    const scriptReferences = useMemo(() => (batch?.inputAssetIds || []).map((id, index) => ({
        title: assets.find((item) => item.id === id && item.kind === "image")?.title || `参考图 ${index + 1}`,
        role: batch?.config.inputAssetRoles?.[id] || "other",
    })), [assets, batch?.inputAssetIds, batch?.config.inputAssetRoles]);
    const draftScripts = batch?.scripts.filter((script) => !script.projectId) || [];
    const projectScripts = batch?.scripts.filter((script) => Boolean(script.projectId)) || [];
    const productionLocked = projectScripts.length > 0;
    const runsByScript = useMemo(() => new Map<string, SmartFilmProductionRun>((batch?.productionRuns || []).filter((run) => run.status !== "archived").map((run) => [run.scriptId, run])), [batch?.productionRuns]);
    const selectedScripts = useMemo(() => (batch?.scripts || []).filter((script) => selected.has(script.id)), [batch?.scripts, selected]);
    const selectedDraftCount = selectedScripts.filter((script) => !script.projectId).length;
    const bulkEligibility = useMemo(() => batchBulkEligibility(selectedScripts, runsByScript), [runsByScript, selectedScripts]);
    const assetExtractionScripts = projectScripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return script.status === "project_created" && run?.assetStatus !== "queued" && run?.assetStatus !== "running";
    });
    const storyboardGenerationScripts = projectScripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return script.status === "assets_extracted" && run?.assetStatus === "confirmed" && run?.storyboardStatus !== "queued" && run?.storyboardStatus !== "running";
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
            const available = new Set(batch.scripts.map((script) => script.id));
            const next = new Set([...current].filter((id) => available.has(id)));
            if (!next.size) batch.scripts.filter((script) => !script.projectId).forEach((script) => next.add(script.id));
            return next;
        });
        const productionSource = [batch.revision, batch.config.productionMode || "", batch.config.shotCount || 0, batch.config.targetDurationSeconds || 0, ...(batch.config.shotDurationsSeconds || [])].join(":");
        if (productionSourceRef.current !== productionSource) {
            productionSourceRef.current = productionSource;
            setProductionModeDraft(batch.config.productionMode || "");
            setShotCountDraft(batch.config.shotCount || 6);
            setTargetDurationDraft(batch.config.targetDurationSeconds || Math.min(30, productionMaxTargetSeconds));
            setShotDurationsDraft(resizeSmartFilmShotDurations(batch.config.shotDurationsSeconds || [], batch.config.shotCount || 6, productionVideoProfile));
        }
    }, [batch, productionMaxTargetSeconds]);

    useEffect(() => {
        if (productionModeDraft !== "fixed") return;
        setShotDurationsDraft((previous) => resizeSmartFilmShotDurations(previous, normalizedDraftShotCount, productionVideoProfile));
    }, [normalizedDraftShotCount, productionModeDraft, productionVideoProfile]);

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: ["smart-film-batch", batchId] });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
        await queryClient.invalidateQueries({ queryKey: ["smart-film-batch-costs", batchId] });
    };

    const updateBatch = (next: SmartFilmBatch) => {
        queryClient.setQueryData(["smart-film-batch", batchId], next);
    };

    const bulkActions = useSmartFilmBatchBulkActions({
        batch,
        selectedScripts,
        effectiveConfig,
        scriptReferences,
        message,
        setBusy,
        updateBatch,
        refresh,
    });

    const openBulkDialog = (kind: SmartFilmBulkDialogKind) => {
        if (busy) return;
        if (!bulkDialogCount(kind, bulkEligibility)) {
            message.warning("当前选中项没有可执行该操作的剧本");
            return;
        }
        setBulkDialog(kind);
    };

    const submitBulkDialog = (value: SmartFilmBulkDialogValue) => {
        const kind = bulkDialog;
        setBulkDialog("");
        if (kind === "title") void bulkActions.runBulkTitle(value.titleTemplate || "", Boolean(value.appendIndex));
        if (kind === "creative") void bulkActions.runBulkCreativeRequirement(value.creativeRequirement || "");
        if (kind === "regenerate") void bulkActions.runBulkRegenerate();
        if (kind === "delete") void bulkActions.runBulkDelete();
        if (kind === "confirm_assets") void bulkActions.runBulkConfirmAssets();
        if (kind === "confirm_storyboard") void bulkActions.runBulkConfirmStoryboard();
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

    const saveProductionConfig = async () => {
        if (!batch || busy) return;
        if (!productionModeDraft) return message.warning("请选择固定分镜或智能整片");
        if (!productionConfigValid) return message.warning("请先填写完整的制作规格");
        setBusy("正在保存制作规格…");
        try {
            const result = await updateSmartFilmBatchProductionConfig(batch.id, {
                productionMode: productionModeDraft,
                ...(productionModeDraft === "fixed"
                    ? { shotCount: normalizedDraftShotCount, shotDurationsSeconds: shotDurationsDraft }
                    : { targetDurationSeconds: Math.max(1, Math.round(Number(targetDurationDraft) || 0)) }),
                expectedRevision: batch.revision,
            });
            updateBatch(result.batch);
            await queryClient.invalidateQueries({ queryKey: ["smart-film-batch-costs", batch.id] });
            message.success("制作规格已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存制作规格失败");
            await refresh();
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
                references: scriptReferences,
                count: Math.max(1, batch.config.scriptCount || 3),
                shotCount: batch.config.shotCount || undefined,
                shotDurationSeconds: batch.config.shotDurationSeconds || undefined,
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
                references: scriptReferences,
                count: 1,
                shotCount: batch.config.shotCount || undefined,
                shotDurationSeconds: batch.config.shotDurationSeconds || undefined,
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
                expectedScriptRevision: script.revision,
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
                expectedScriptRevision: editing.revision,
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
        if (!batch.config.productionMode) return message.warning("请先选择并保存分镜策略");
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

    const runProjectRecovery = async (script: SmartFilmScript, mode: SmartFilmRecoveryMode) => {
        if (!batch || busy) return;
        const run = runsByScript.get(script.id);
        if (!run) return;
        const stage = smartFilmRecoveryStage(run.failedStep);
        if (!stage) return message.warning("当前失败发生在项目创建阶段，请使用批次修复入口");
        setBusy(mode === "regenerate" ? `正在重新生成「${script.title}」…` : `正在重试「${script.title}」…`);
        try {
            const result = await controlSmartFilmProductionRun(batch.id, run.id, mode, stage);
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            message.success(smartFilmRecoveryMessage(mode, Boolean(result.run.retryReusedTask)));
        } catch (error) {
            message.error(error instanceof Error ? error.message : mode === "regenerate" ? "重新生成失败" : "重试失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const retryProject = async (script: SmartFilmScript) => runProjectRecovery(script, "retry");

    const regenerateProject = (script: SmartFilmScript) => {
        if (!batch || busy) return;
        const run = runsByScript.get(script.id);
        if (!run) return;
        modal.confirm({
            title: `重新生成「${script.title}」的失败阶段？`,
            content: "这会创建新的模型任务，不复用已有任务结果，可能产生费用。仅在已有结果不可用或你明确需要重做时使用。",
            okText: "确认重新生成",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => runProjectRecovery(script, "regenerate"),
        });
    };

    const toggle = (id: string, checked: boolean) => {
        setSelected((current) => {
            const next = new Set(current);
            if (checked) next.add(id); else next.delete(id);
            return next;
        });
    };

    const bulkMenuItems: MenuProps["items"] = [
        { key: "title", label: `批量修改标题（${bulkEligibility.title}）`, disabled: !bulkEligibility.title },
        { key: "creative", label: `应用创意要求（${bulkEligibility.creative}）`, disabled: !bulkEligibility.creative },
        { key: "regenerate", label: `重新生成草稿（${bulkEligibility.regenerate}）`, danger: true, disabled: !bulkEligibility.regenerate },
        { key: "delete", label: `删除草稿（${bulkEligibility.delete}）`, danger: true, disabled: !bulkEligibility.delete },
        { type: "divider" },
        { key: "confirm_assets", label: `确认项目资产（${bulkEligibility.confirmAssets}）`, disabled: !bulkEligibility.confirmAssets },
        { key: "confirm_storyboard", label: `确认项目分镜（${bulkEligibility.confirmStoryboard}）`, disabled: !bulkEligibility.confirmStoryboard },
    ];

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
                        <div><span>参考图</span><strong>{batch.inputAssetIds.length}</strong></div>
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

                {batch.scripts.length ? (
                    <section className="smart-film-production-config">
                        <div className="smart-film-production-config-head">
                            <div>
                                <strong>制作规格与分镜策略</strong>
                                <span>剧本确认后再决定分镜。模型已在本批次创建时固定，后续不再重复选择。</span>
                            </div>
                            <Tag bordered={false}>{productionLocked ? "已锁定" : productionModeDraft ? "待确认" : "待设置"}</Tag>
                        </div>
                        <div className="smart-film-production-mode-row">
                            <label>
                                <span>分镜方式</span>
                                <Select
                                    value={productionModeDraft || undefined}
                                    disabled={productionLocked || Boolean(busy)}
                                    placeholder="选择分镜方式"
                                    onChange={(value) => setProductionModeDraft(value)}
                                    options={[
                                        { value: "fixed", label: "固定分镜：一张分镜图对应一个镜头视频" },
                                        { value: "smart", label: "智能整片：由模型决定镜头，全部镜头图合成一个视频" },
                                    ]}
                                />
                            </label>
                            {!productionModeDraft ? <p>先生成并挑选剧本，再选择固定分镜或智能整片。</p> : null}
                        </div>
                        {productionModeDraft === "fixed" ? (
                            <div className="smart-film-production-fixed">
                                <label>
                                    <span>镜头数量</span>
                                    <InputNumber
                                        min={1}
                                        max={200}
                                        precision={0}
                                        value={shotCountDraft}
                                        disabled={productionLocked || Boolean(busy)}
                                        onChange={setShotCountDraft}
                                        addonAfter="镜"
                                    />
                                </label>
                                <div className="smart-film-production-duration-heading">
                                    <strong>逐镜时长</strong>
                                    <span>当前视频模型单镜上限 {productionMaxClipSeconds} 秒；每个分镜图会对应一个镜头视频。</span>
                                </div>
                                <div className="smart-film-duration-grid">
                                    {shotDurationsDraft.map((duration, index) => (
                                        <label key={index}>
                                            <span>镜头 {index + 1}</span>
                                            <Select
                                                value={duration}
                                                disabled={productionLocked || Boolean(busy)}
                                                options={productionDurationOptions.map((value) => ({ value, label: `${value} 秒` }))}
                                                onChange={(value) => setShotDurationsDraft((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))}
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {productionModeDraft === "smart" ? (
                            <div className="smart-film-production-smart">
                                <label>
                                    <span>目标成片总时长</span>
                                    <InputNumber
                                        min={1}
                                        max={productionMaxTargetSeconds}
                                        precision={0}
                                        value={targetDurationDraft}
                                        disabled={productionLocked || Boolean(busy)}
                                        onChange={setTargetDurationDraft}
                                        addonAfter="秒"
                                    />
                                </label>
                                <p>模型会根据剧本和总时长自动决定分镜数量。当前视频模型单次最多生成 {productionMaxTargetSeconds} 秒，分镜图确认后会把全部镜头图作为一个完整视频生成。</p>
                            </div>
                        ) : null}
                        <div className="smart-film-production-config-foot">
                            <span>视频模型：{batch.config.defaultVideoModel || effectiveConfig.videoModel || "未配置"}</span>
                            {productionLocked ? <span>项目已经开始制作，制作规格不可再修改。</span> : <Button type="primary" loading={Boolean(busy)} disabled={!productionConfigValid} onClick={() => void saveProductionConfig()}>保存制作规格</Button>}
                        </div>
                    </section>
                ) : null}

                <div className="smart-film-batch-toolbar">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={Boolean(batch.scripts.length) && selectedScripts.length === batch.scripts.length}
                            indeterminate={selectedScripts.length > 0 && selectedScripts.length < batch.scripts.length}
                            onChange={(event) => setSelected(event.target.checked ? new Set(batch.scripts.map((script) => script.id)) : new Set())}
                        >选择全部剧本</Checkbox>
                        <span className="text-xs text-foreground/45">已选 {selectedScripts.length} 条</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {!batch.scripts.length ? <Button icon={<Sparkles className="size-4" />} loading={Boolean(busy)} onClick={() => void generateMissingScripts()}>生成剧本</Button> : null}
                        {recoverableScripts.length ? <Button danger icon={<RefreshCcw className="size-4" />} disabled={Boolean(busy)} onClick={() => void retryFailedRuns()}>修复批次创建（{recoverableScripts.length}）</Button> : null}
                        {assetExtractionScripts.length ? <Button icon={<Layers3 className="size-4" />} disabled={Boolean(busy)} onClick={() => void extractPendingProjectAssets()}>提取资产（{assetExtractionScripts.length}）</Button> : null}
                        {storyboardGenerationScripts.length ? <Button icon={<Clapperboard className="size-4" />} disabled={Boolean(busy)} onClick={() => void generatePendingStoryboards()}>生成分镜提示词（{storyboardGenerationScripts.length}）</Button> : null}
                        <Button icon={<Columns3 className="size-4" />} disabled={!canCompareSmartFilmScripts(selectedScripts) || Boolean(busy)} onClick={() => setComparisonOpen(true)}>对比剧本</Button>
                        <Dropdown trigger={["click"]} menu={{ items: bulkMenuItems, onClick: ({ key }) => openBulkDialog(key as SmartFilmBulkDialogKind) }}>
                            <Button icon={<Layers3 className="size-4" />} disabled={!selectedScripts.length || Boolean(busy)}>批量操作<ChevronDown className="size-3.5" /></Button>
                        </Dropdown>
                        <Button type="primary" icon={<Play className="size-4" />} disabled={!selectedDraftCount || Boolean(busy)} onClick={() => void confirmSelected()}>创建独立视频项目</Button>
                    </div>
                </div>

                {batch.scripts.length ? (
                    <div className="smart-film-script-list">
                        {batch.scripts.map((script, index) => (
                            <article className={`smart-film-script-card${selected.has(script.id) ? " is-selected" : ""}`} key={script.id}>
                                <div className="smart-film-script-check">
                                    <Checkbox checked={selected.has(script.id)} disabled={Boolean(busy)} onChange={(event) => toggle(script.id, event.target.checked)} />
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
                                    {smartFilmRecoveryStage(runsByScript.get(script.id)?.failedStep) ? (
                                        <div className="smart-film-recovery-hint">
                                            <span>重试并优先复用：有可复用结果时直接继续，否则提交新任务。</span>
                                            <span>重新生成：新建模型任务，可能产生费用。</span>
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
                                            {script.status === "assets_extracted" && runsByScript.get(script.id)?.assetStatus !== "confirmed" ? <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/assets`)}>确认资产与资产图</Button> : null}
                                            {script.status === "assets_extracted" && runsByScript.get(script.id)?.assetStatus === "confirmed" ? (
                                                runsByScript.get(script.id)?.storyboardStatus === "queued" || runsByScript.get(script.id)?.storyboardStatus === "running"
                                                    ? <Button size="small" loading disabled>分镜提示词生成中</Button>
                                                    : <Button size="small" icon={<Sparkles className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void generateProjectStoryboard(script)}>生成分镜提示词</Button>
                                            ) : null}
                                            {script.status === "storyboard_ready" ? <Button size="small" type="primary" icon={<Clapperboard className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/workflow/${script.unitId}/storyboard`)}>确认分镜提示词与分镜图</Button> : null}
                                            <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/workflow/${script.unitId}/${script.status === "storyboard_ready" ? "storyboard" : "assets"}`)}>打开项目</Button>
                                            {runsByScript.get(script.id)?.controlStatus !== "skipped" ? (
                                                runsByScript.get(script.id)?.controlStatus === "paused"
                                                    ? <Button size="small" icon={<Play className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void controlProject(script, "resume")}>继续项目</Button>
                                                    : <Button size="small" icon={<Pause className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void controlProject(script, "pause")}>暂停项目</Button>
                                            ) : null}
                                            {runsByScript.get(script.id)?.controlStatus !== "skipped" ? <Button size="small" icon={<SkipForward className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void controlProject(script, "skip")}>跳过</Button> : null}
                                            {(runsByScript.get(script.id)?.status === "needs_attention" || script.status === "needs_attention") && smartFilmRecoveryStage(runsByScript.get(script.id)?.failedStep) ? (
                                                <>
                                                    <Button size="small" icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void retryProject(script)}>重试并优先复用</Button>
                                                    <Button size="small" danger icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => regenerateProject(script)}>重新生成</Button>
                                                </>
                                            ) : null}
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
                        <span>上次生成可能中断了。可以按同一组想法和参考图重新生成 {batch.config.scriptCount} 条独立剧本。</span>
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
            <SmartFilmBatchBulkDialog
                kind={bulkDialog}
                count={bulkDialogCount(bulkDialog, bulkEligibility)}
                busy={Boolean(busy)}
                onCancel={() => setBulkDialog("")}
                onSubmit={submitBulkDialog}
            />
            <SmartFilmScriptComparisonDialog open={comparisonOpen} scripts={selectedScripts} onClose={() => setComparisonOpen(false)} />
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
