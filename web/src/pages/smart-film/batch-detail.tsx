import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Tag, Tooltip } from "antd";
import { CheckCircle2, CircleAlert, Clapperboard, Columns3, Edit3, LoaderCircle, Play, RefreshCcw, Sparkles, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { resolveCanvasStylePreset } from "@/components/canvas/canvas-style-picker-modal";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { parseStyleProfile } from "@/lib/canvas/style-profile";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { normalizeSmartFilmShotCount, resizeSmartFilmShotDurations, smartFilmDefaultShotSeconds, smartFilmDurationOptions, smartFilmMaxClipSeconds } from "@/lib/canvas/smart-film-options";
import {
    controlSmartFilmProductionRun,
    confirmSmartFilmBatchScripts,
    deleteSmartFilmBatchScript,
    getSmartFilmBatch,
    getSmartFilmBatchCosts,
    previewSmartFilmBatchProductionConfig,
    recoverSmartFilmBatchScripts,
    saveSmartFilmBatchScripts,
    startSmartFilmProductionStage,
    updateSmartFilmBatchSkill,
    updateSmartFilmBatchProductionConfig,
    updateSmartFilmBatchScript,
    type SmartFilmBatch,
    type SmartFilmProductionRun,
    type SmartFilmScript,
    type SmartFilmScriptStatus,
} from "@/services/api/smart-film-batches";
import { updateProjectUnit } from "@/services/api/projects";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useSkillRuntimeCatalog } from "@/components/skills/skill-runtime-picker";
import { createSmartFilmSkillSnapshot } from "@/services/smart-film-skill";
import { generateSmartFilmScripts, quoteSmartFilmScripts, type SmartFilmScriptGenerationInput } from "./smart-film-script-generation";
import { smartFilmRecoveryMessage, smartFilmRecoveryStage, type SmartFilmRecoveryMode } from "./smart-film-recovery";
import { canCompareSmartFilmScripts } from "./smart-film-script-comparison";
import { SmartFilmScriptComparisonDialog } from "./smart-film-script-comparison-dialog";
import { smartFilmScriptReferenceBundle } from "./smart-film-script-references";
import { SmartFilmBatchProductionConfig } from "./smart-film-batch-production-config";
import { SmartFilmBatchScriptEditDialog, SmartFilmBatchScriptEmptyState } from "./smart-film-batch-script-states";
import { smartFilmBatchModelConfig, smartFilmScriptStatusColor } from "./smart-film-batch-detail-utils";
import { SmartFilmBatchDetailHero } from "./smart-film-batch-detail-hero";

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
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const { skills: installedSkills, loading: skillsLoading } = useSkillRuntimeCatalog();
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [comparisonOpen, setComparisonOpen] = useState(false);
    const [editing, setEditing] = useState<SmartFilmScript | null>(null);
    const [draftTitle, setDraftTitle] = useState("");
    const [draftContent, setDraftContent] = useState("");
    const [busy, setBusy] = useState("");
    const [skillDraftId, setSkillDraftId] = useState("");
    const [skillSaving, setSkillSaving] = useState(false);
    const [productionSaving, setProductionSaving] = useState(false);
    const [productionModeDraft, setProductionModeDraft] = useState<"fixed" | "smart" | "">("");
    const [shotCountDraft, setShotCountDraft] = useState<number | null>(6);
    const [shotDurationsDraft, setShotDurationsDraft] = useState<number[]>([]);
    const [targetDurationDraft, setTargetDurationDraft] = useState<number | null>(30);
    const [scriptGenerationError, setScriptGenerationError] = useState("");
    const productionHydratedBatchRef = useRef("");
    const productionSaveRevisionRef = useRef(0);
    const productionSavePayloadRef = useRef<{
        productionMode: "fixed" | "smart";
        shotCount?: number;
        shotDurationsSeconds?: number[];
        targetDurationSeconds?: number;
    } | null>(null);
    const productionSaveInFlightRef = useRef(false);
    const productionSaveQueuedRef = useRef(false);
    const [productionSaveRetry, setProductionSaveRetry] = useState(0);
    const autoStartedAssetRunsRef = useRef<Set<string>>(new Set());
    const autoStartedStoryboardRunsRef = useRef<Set<string>>(new Set());
    const scriptRecoveryAttemptedRef = useRef(false);
    const batchQuery = useQuery({
        queryKey: ["smart-film-batch", batchId],
        queryFn: ({ signal }) => getSmartFilmBatch(batchId, signal).then((result) => result.batch),
        enabled: Boolean(batchId),
        refetchInterval: (query) => (query.state.data?.productionRuns?.some((run) => ["queued", "running"].includes(run.assetStatus) || ["queued", "running"].includes(run.storyboardStatus)) ? 3000 : false),
    });
    const batch = batchQuery.data;
    const batchCostQuery = useQuery({
        queryKey: ["smart-film-batch-costs", batchId, batch?.revision],
        queryFn: () => getSmartFilmBatchCosts(batchId),
        enabled: Boolean(batchId && batch?.scripts.length),
        retry: false,
        staleTime: 15_000,
    });
    const resolvedProductionVideoModel = batch?.config.defaultVideoModel || effectiveConfig.videoModel;
    const productionVideoProfile = useMemo(() => modelCapabilityConfigFor(effectiveConfig, resolvedProductionVideoModel).video, [effectiveConfig, resolvedProductionVideoModel]);
    const productionDurationOptions = useMemo(() => smartFilmDurationOptions(productionVideoProfile), [productionVideoProfile]);
    const productionDefaultShotSeconds = smartFilmDefaultShotSeconds(productionVideoProfile);
    const productionMaxClipSeconds = smartFilmMaxClipSeconds(productionVideoProfile);
    const productionMaxTargetSeconds = productionMaxClipSeconds;
    const normalizedDraftShotCount = normalizeSmartFilmShotCount(shotCountDraft);
    const productionConfigValid =
        productionModeDraft === "fixed"
            ? shotDurationsDraft.length === normalizedDraftShotCount && shotDurationsDraft.every((duration) => duration > 0 && duration <= productionMaxClipSeconds)
            : productionModeDraft === "smart"
              ? Number(targetDurationDraft) >= 1 && Number(targetDurationDraft) <= productionMaxTargetSeconds
              : false;
    const productionDraftMatchesSaved = useMemo(() => {
        if (!batch) return false;
        const savedDurations = batch.config.shotDurationsSeconds?.length ? batch.config.shotDurationsSeconds : Array.from({ length: batch.config.shotCount || 0 }, () => batch.config.shotDurationSeconds || 0);
        return (
            productionModeDraft === batch.config.productionMode &&
            (productionModeDraft === "fixed"
                ? normalizedDraftShotCount === (batch.config.shotCount || 0) && JSON.stringify(shotDurationsDraft) === JSON.stringify(savedDurations)
                : Math.round(Number(targetDurationDraft) || 0) === (batch.config.targetDurationSeconds || 0))
        );
    }, [batch, normalizedDraftShotCount, productionModeDraft, shotDurationsDraft, targetDurationDraft]);
    const batchSpec = useMemo(() => {
        if (!batch) return "";
        const durationCopy =
            batch.config.productionMode === "smart"
                ? `智能整片 · 目标 ${batch.config.targetDurationSeconds || 0} 秒`
                : batch.config.productionMode === "fixed"
                  ? (() => {
                        const durations = batch.config.shotDurationsSeconds?.length ? batch.config.shotDurationsSeconds : Array.from({ length: batch.config.shotCount || 0 }, () => batch.config.shotDurationSeconds || 0);
                        return durations.length && durations.every((duration) => duration === durations[0]) ? `${batch.config.shotCount} 镜 × ${durations[0]} 秒` : `逐镜 ${durations.join(" / ")} 秒`;
                    })()
                  : "分镜策略待设置";
        const styleTitle = parseStyleProfile(batch.config.styleProfileJson)?.title || resolveCanvasStylePreset(batch.config.stylePresetId || "")?.title || (batch.config.stylePresetId ? "自定义画风" : "未设置画风");
        return `画幅 ${batch.config.aspectRatio} · ${durationCopy} · ${styleTitle}`;
    }, [batch]);
    const productionCostLabel = !batch?.scripts.length
        ? "待生成"
        : !batch.config.productionMode
          ? "待定规格"
          : batchCostQuery.isFetching
            ? "核算中"
            : batchCostQuery.isError
              ? "待核对"
              : batchCostQuery.data?.enabled
                ? `${batchCostQuery.data.totalPoints} 积分`
                : "未启用";
    const scriptReferenceAssets = useMemo(
        () =>
            (batch?.inputAssetIds || []).flatMap((id) => {
                const asset = assets.find((item) => item.id === id && item.kind === "image");
                return asset ? [asset as ImageAsset] : [];
            }),
        [assets, batch?.inputAssetIds],
    );
    const missingScriptReferenceCount = Math.max(0, (batch?.inputAssetIds.length || 0) - scriptReferenceAssets.length);
    const scriptReferenceBundle = useMemo(
        () => smartFilmScriptReferenceBundle(scriptReferenceAssets, batch?.config.inputAssetNames || {}, batch?.config.inputAssetRoles || {}),
        [batch?.config.inputAssetNames, batch?.config.inputAssetRoles, scriptReferenceAssets],
    );
    const scriptGenerationInput = useMemo<SmartFilmScriptGenerationInput | null>(
        () =>
            batch
                ? {
                      idea: batch.sourceText,
                      references: scriptReferenceBundle.references,
                      referenceImages: scriptReferenceBundle.referenceImages,
                      count: Math.max(1, batch.config.scriptCount || 3),
                      shotCount: batch.config.shotCount || undefined,
                      shotDurationSeconds: batch.config.shotDurationSeconds || undefined,
                      config: smartFilmBatchModelConfig(batch, effectiveConfig),
                      batchId: batch.id,
                      existingTitles: batch.scripts.map((script) => script.title),
                      skillSnapshot: batch.config.skillSnapshot,
                  }
                : null,
        [batch, effectiveConfig, scriptReferenceBundle],
    );
    const scriptQuoteQuery = useQuery({
        queryKey: ["smart-film-script-quote", batchId, batch?.revision, batch?.config.defaultTextModel, scriptReferenceBundle.references.map((reference) => `${reference.imageIndex || 0}:${reference.role}:${reference.title}`).join("|")],
        queryFn: () => quoteSmartFilmScripts(scriptGenerationInput!),
        enabled: Boolean(batch && !batch.scripts.length && scriptGenerationInput && assetsHydrated && !missingScriptReferenceCount),
        retry: false,
        staleTime: 30_000,
    });
    const draftScripts = batch?.scripts.filter((script) => !script.projectId) || [];
    const projectScripts = batch?.scripts.filter((script) => Boolean(script.projectId)) || [];
    const productionLocked = projectScripts.length > 0;
    const currentSkillSnapshot = batch?.config.skillSnapshot;
    const currentSkillId = currentSkillSnapshot?.skillId || "";
    const skillDirty = skillDraftId !== currentSkillId;
    const skillOptions = useMemo(() => {
        const options = installedSkills.map((skill) => ({ value: skill.skillId, label: `${skill.skillName} · ${skill.version}` }));
        if (currentSkillSnapshot && !options.some((option) => option.value === currentSkillSnapshot.skillId)) {
            options.unshift({ value: currentSkillSnapshot.skillId, label: `${currentSkillSnapshot.name} · 当前版本不可用` });
        }
        return options;
    }, [currentSkillSnapshot, installedSkills]);
    const runsByScript = useMemo(() => new Map<string, SmartFilmProductionRun>((batch?.productionRuns || []).filter((run) => run.status !== "archived").map((run) => [run.scriptId, run])), [batch?.productionRuns]);
    const selectedScripts = useMemo(() => (batch?.scripts || []).filter((script) => selected.has(script.id)), [batch?.scripts, selected]);
    const selectedDraftCount = selectedScripts.filter((script) => !script.projectId).length;
    const createProjectHint = !selectedDraftCount ? "请先勾选尚未创建项目的剧本" : productionSaving ? "制作规格正在自动保存，请稍候" : !productionConfigValid ? "请完成分镜方式和时长设置" : !productionDraftMatchesSaved ? "正在同步最新制作规格" : undefined;
    const assetExtractionScripts = projectScripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return script.status === "project_created" && Boolean(run) && (run!.assetStatus === "pending" || run!.assetStatus === "waiting") && run!.status !== "needs_attention" && run!.status !== "failed";
    });
    const storyboardGenerationScripts = projectScripts.filter((script) => {
        const run = runsByScript.get(script.id);
        return script.status === "assets_extracted" && Boolean(run) && run!.assetStatus === "confirmed" && (run!.storyboardStatus === "pending" || run!.storyboardStatus === "waiting") && run!.status !== "needs_attention" && run!.status !== "failed";
    });
    const recoverableScripts =
        batch?.scripts.filter((script) => {
            const run = runsByScript.get(script.id);
            return Boolean(script.projectId && !script.unitId) || script.status === "needs_attention" || script.status === "failed" || run?.status === "needs_attention" || run?.status === "failed";
        }) || [];
    const scriptQuoteError = scriptQuoteQuery.isError && scriptQuoteQuery.error instanceof Error ? scriptQuoteQuery.error.message : scriptQuoteQuery.isError ? "无法核算剧本生成积分" : "";
    const visibleScriptGenerationError =
        scriptGenerationError ||
        (!batch?.scripts.length ? scriptQuoteError : "") ||
        (assetsHydrated && missingScriptReferenceCount ? `有 ${missingScriptReferenceCount} 张参考素材不在当前素材库，请恢复素材后再生成剧本。` : "");
    const scriptGenerationQuoteText = !batch?.scripts.length
        ? assetsHydrated && missingScriptReferenceCount
            ? "参考素材未就绪，暂不能生成"
            : !assetsHydrated || scriptQuoteQuery.isFetching
              ? "正在核对本次剧本生成积分…"
              : scriptQuoteQuery.data?.enabled
                ? `本次生成 ${batch?.config.scriptCount || 1} 条剧本约 ${scriptQuoteQuery.data.points} 积分${typeof scriptQuoteQuery.data.balance === "number" ? ` · 当前余额 ${scriptQuoteQuery.data.balance} 积分` : ""}`
                : scriptQuoteQuery.isSuccess
                  ? "当前渠道未启用积分计费"
                  : "等待积分报价"
        : "";

    useEffect(() => {
        if (!batch) return;
        setSelected((current) => {
            const available = new Set(batch.scripts.map((script) => script.id));
            const next = new Set([...current].filter((id) => available.has(id)));
            if (!next.size) batch.scripts.filter((script) => !script.projectId).forEach((script) => next.add(script.id));
            return next;
        });
        productionSaveRevisionRef.current = batch.revision;
        if (productionHydratedBatchRef.current === batch.id) return;
        productionHydratedBatchRef.current = batch.id;
        setProductionModeDraft(batch.config.productionMode || "");
        setShotCountDraft(batch.config.shotCount || 6);
        setTargetDurationDraft(batch.config.targetDurationSeconds || Math.min(30, productionMaxTargetSeconds));
        setShotDurationsDraft(resizeSmartFilmShotDurations(batch.config.shotDurationsSeconds || [], batch.config.shotCount || 6, productionVideoProfile));
    }, [batch, productionMaxTargetSeconds]);

    useEffect(() => {
        if (productionModeDraft !== "fixed") return;
        setShotDurationsDraft((previous) => {
            const next = resizeSmartFilmShotDurations(previous, normalizedDraftShotCount, productionVideoProfile);
            return previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next;
        });
    }, [normalizedDraftShotCount, productionModeDraft, productionVideoProfile]);

    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: ["smart-film-batch", batchId] });
        await queryClient.invalidateQueries({ queryKey: ["projects"] });
    }, [batchId, queryClient]);

    const updateBatch = useCallback(
        (next: SmartFilmBatch) => {
            queryClient.setQueryData(["smart-film-batch", batchId], next);
        },
        [batchId, queryClient],
    );

    useEffect(() => {
        setSkillDraftId(currentSkillId);
    }, [batch?.id, currentSkillId]);

    const applyBatchSkill = async () => {
        if (!batch || productionLocked || skillSaving) return;
        setSkillSaving(true);
        try {
            const skillToApply = skillDraftId ? installedSkills.find((skill) => skill.skillId === skillDraftId) : undefined;
            if (skillDraftId && !skillToApply) throw new Error("所选技能不可用，请刷新技能库后重试");
            const snapshot = skillToApply ? await createSmartFilmSkillSnapshot(skillToApply, installedSkills) : undefined;
            const result = await updateSmartFilmBatchSkill(batch.id, snapshot, batch.revision);
            updateBatch(result.batch);
            if (snapshot && batch.scripts.length) message.warning("项目技能已更换；已有剧本不会自动重写，请重新生成剧本后再创建项目");
            else message.success(snapshot ? `本次多剧本项目已固定使用「${snapshot.name}」` : "本次多剧本项目已切换为平台默认技能规则");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "项目技能更新失败");
        } finally {
            setSkillSaving(false);
        }
    };

    const recoverMissingScripts = useCallback(
        async (announce = true) => {
            if (!batch || busy) return false;
            setBusy("正在恢复上次生成结果…");
            try {
                const result = await recoverSmartFilmBatchScripts(batch.id);
                updateBatch(result.batch);
                message.success(`已恢复 ${result.batch.scripts.length} 条上次生成成功的剧本`);
                return true;
            } catch (error) {
                if (announce) message.warning(error instanceof Error ? error.message : "没有找到可恢复的剧本生成结果");
                return false;
            } finally {
                setBusy("");
            }
        },
        [batch, busy, message, updateBatch],
    );

    useEffect(() => {
        if (!batch || batch.scripts.length || busy || scriptRecoveryAttemptedRef.current) return;
        scriptRecoveryAttemptedRef.current = true;
        void recoverMissingScripts(false);
    }, [batch, busy, recoverMissingScripts]);

    const productionSavePayload = useMemo(() => {
        if (!productionConfigValid || !productionModeDraft) return null;
        return productionModeDraft === "fixed"
            ? {
                  productionMode: "fixed" as const,
                  shotCount: normalizedDraftShotCount,
                  shotDurationsSeconds: shotDurationsDraft,
              }
            : {
                  productionMode: "smart" as const,
                  targetDurationSeconds: Math.max(1, Math.round(Number(targetDurationDraft) || 0)),
              };
    }, [normalizedDraftShotCount, productionConfigValid, productionModeDraft, shotDurationsDraft, targetDurationDraft]);
    const productionSavePayloadSignature = productionSavePayload ? JSON.stringify(productionSavePayload) : "";
    productionSavePayloadRef.current = productionSavePayload;

    useEffect(() => {
        if (!batch || productionLocked) {
            setProductionSaving(false);
            return;
        }
        if (!productionConfigValid) {
            setProductionSaving(false);
            return;
        }
        if (productionDraftMatchesSaved) {
            setProductionSaving(false);
            return;
        }
        setProductionSaving(true);
        const timer = window.setTimeout(() => {
            if (productionSaveInFlightRef.current) {
                productionSaveQueuedRef.current = true;
                return;
            }
            productionSaveInFlightRef.current = true;
            void (async () => {
                try {
                    while (true) {
                        const payload = productionSavePayloadRef.current;
                        if (!payload) break;
                        const requestSignature = JSON.stringify(payload);
                        let budgetPoints: number | undefined;
                        try {
                            const preview = await previewSmartFilmBatchProductionConfig(batch.id, {
                                ...payload,
                                expectedRevision: productionSaveRevisionRef.current,
                            });
                            if (preview.enabled) budgetPoints = preview.totalPoints;
                        } catch {
                            // Spec persistence must remain available when pricing is temporarily unavailable.
                        }
                        const result = await updateSmartFilmBatchProductionConfig(batch.id, {
                            ...payload,
                            ...(budgetPoints === undefined ? {} : { budgetPoints }),
                            expectedRevision: productionSaveRevisionRef.current,
                        });
                        productionSaveRevisionRef.current = result.batch.revision;
                        updateBatch(result.batch);
                        const latestPayload = productionSavePayloadRef.current;
                        if (!latestPayload || JSON.stringify(latestPayload) === requestSignature) break;
                    }
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "自动保存制作规格失败");
                    await refresh();
                } finally {
                    productionSaveInFlightRef.current = false;
                    setProductionSaving(false);
                    if (productionSaveQueuedRef.current) {
                        productionSaveQueuedRef.current = false;
                        setProductionSaveRetry((current) => current + 1);
                    }
                }
            })();
        }, 700);
        return () => window.clearTimeout(timer);
    }, [batch?.id, batch?.revision, message, productionConfigValid, productionDraftMatchesSaved, productionLocked, productionSavePayloadSignature, productionSaveRetry, refresh, updateBatch]);

    const approveScriptGeneration = async (input: SmartFilmScriptGenerationInput): Promise<boolean> => {
        try {
            const quote = await quoteSmartFilmScripts(input);
            if (!quote.enabled) return true;
            if (typeof quote.balance === "number" && quote.balance < quote.points) {
                throw new Error(`积分不足：本次需要 ${quote.points} 积分，当前余额 ${quote.balance} 积分`);
            }
            return await new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: `生成 ${input.regenerateIndex ? 1 : input.count} 条剧本？`,
                    content: `本次会创建一个文本任务，预计先扣除 ${quote.points} 积分${typeof quote.balance === "number" ? `，当前余额 ${quote.balance} 积分` : ""}。此金额按提示词估算输入 Token，并按最多 4,096 输出 Token 预留；完成后会按实际 Token 差额退还或补扣。`,
                    okText: "确认生成",
                    cancelText: "取消",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : "剧本生成报价失败";
            setScriptGenerationError(reason);
            message.error(reason);
            return false;
        }
    };

    const generateMissingScripts = async () => {
        if (!batch || !scriptGenerationInput || busy) return;
        setScriptGenerationError("");
        setBusy("正在核算剧本生成积分…");
        try {
            if (!(await approveScriptGeneration(scriptGenerationInput))) return;
            setBusy("正在生成剧本候选…");
            const generated = await generateSmartFilmScripts(scriptGenerationInput);
            const result = await saveSmartFilmBatchScripts(
                batch.id,
                generated.scripts.map((script) => ({
                    title: script.title,
                    content: script.content,
                    taskId: generated.taskId,
                })),
                batch.revision,
            );
            updateBatch(result.batch);
            message.success(`已生成 ${generated.scripts.length} 条独立剧本`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : "剧本生成失败";
            setScriptGenerationError(reason);
            message.error(reason);
        } finally {
            setBusy("");
        }
    };

    const regenerateScript = async (script: SmartFilmScript) => {
        if (!batch || !scriptGenerationInput || busy || script.projectId) return;
        const input: SmartFilmScriptGenerationInput = {
            ...scriptGenerationInput,
            count: 1,
            existingTitles: batch.scripts.filter((item) => item.id !== script.id).map((item) => item.title),
            regenerateIndex: batch.scripts.findIndex((item) => item.id === script.id) + 1,
        };
        setScriptGenerationError("");
        setBusy("正在核算剧本生成积分…");
        try {
            if (!(await approveScriptGeneration(input))) return;
            setBusy(`正在重新生成「${script.title}」…`);
            const generated = await generateSmartFilmScripts(input);
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
            const reason = error instanceof Error ? error.message : "重新生成失败";
            setScriptGenerationError(reason);
            message.error(reason);
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
        if (productionSaving || !productionDraftMatchesSaved) return message.warning("制作规格正在自动保存，请稍候");
        if (!batch.config.productionMode) return message.warning("请先选择分镜策略");
        modal.confirm({
            title: `为 ${scriptIds.length} 条剧本分别创建独立视频项目？`,
            content: "每条剧本会创建自己的项目。系统先分析剧本所需资产：已上传的素材会关联到项目，缺失资产会生成可修改的提示词；资产确认后再生成分镜提示词。",
            okText: "创建独立视频项目",
            cancelText: "取消",
            onOk: async () => {
                setBusy("正在创建项目并分析剧本资产…");
                try {
                    const result = await confirmSmartFilmBatchScripts(batch.id, scriptIds, batch.revision);
                    updateBatch(result.batch);
                    const selectedIds = new Set(scriptIds);
                    const newRuns = result.batch.productionRuns.filter((run) => selectedIds.has(run.scriptId) && ["waiting", "pending"].includes(run.assetStatus));
                    newRuns.forEach((run) => autoStartedAssetRunsRef.current.add(run.scriptId));
                    const failures: string[] = [];
                    for (const run of newRuns) {
                        try {
                            await startSmartFilmProductionStage(batch.id, run.id, "assets");
                        } catch (error) {
                            autoStartedAssetRunsRef.current.delete(run.scriptId);
                            failures.push(error instanceof Error ? error.message : "启动失败");
                        }
                    }
                    const latest = await getSmartFilmBatch(batch.id);
                    updateBatch(latest.batch);
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    if (failures.length) message.warning(`已创建 ${scriptIds.length} 个项目，${failures.length} 个资产分析启动失败：${failures.slice(0, 3).join("；")}`);
                    else message.success(`已创建 ${scriptIds.length} 个独立视频项目，剧本资产分析已自动开始`);
                    const createdScript = latest.batch.scripts.find((script) => script.id === scriptIds[0] && script.projectId);
                    if (scriptIds.length === 1 && createdScript?.projectId) {
                        navigate(`/projects/${createdScript.projectId}/overview`);
                    } else if (scriptIds.length > 1) {
                        navigate(`/projects?batch=${encodeURIComponent(batch.id)}`);
                    }
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
            const result = await confirmSmartFilmBatchScripts(
                batch.id,
                recoverableScripts.map((script) => script.id),
                batch.revision,
            );
            updateBatch(result.batch);
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("多剧本项目创建已恢复");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "多剧本项目恢复失败");
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const assetAutoStartKey = assetExtractionScripts.map((script) => script.id).join(",");
    useEffect(() => {
        if (!batch || !assetAutoStartKey) return;
        const targets = assetExtractionScripts.filter((script) => !autoStartedAssetRunsRef.current.has(script.id));
        if (!targets.length) return;
        targets.forEach((script) => autoStartedAssetRunsRef.current.add(script.id));
        void (async () => {
            const failures: string[] = [];
            for (const script of targets) {
                const run = runsByScript.get(script.id);
                if (!run) {
                    failures.push(`${script.title}：缺少生产运行记录`);
                    continue;
                }
                try {
                    await startSmartFilmProductionStage(batch.id, run.id, "assets");
                } catch (error) {
                    autoStartedAssetRunsRef.current.delete(script.id);
                    failures.push(`${script.title}：${error instanceof Error ? error.message : "启动失败"}`);
                }
            }
            if (failures.length) message.warning(`资产分析自动启动失败：${failures.slice(0, 3).join("；")}`);
            else message.success("项目已创建，剧本资产分析已自动开始");
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
        })();
    }, [assetAutoStartKey, batch?.id, runsByScript, message, queryClient]);

    const storyboardAutoStartKey = storyboardGenerationScripts.map((script) => script.id).join(",");
    useEffect(() => {
        if (!batch || !storyboardAutoStartKey) return;
        const targets = storyboardGenerationScripts.filter((script) => !autoStartedStoryboardRunsRef.current.has(script.id));
        if (!targets.length) return;
        targets.forEach((script) => autoStartedStoryboardRunsRef.current.add(script.id));
        void (async () => {
            const failures: string[] = [];
            for (const script of targets) {
                const run = runsByScript.get(script.id);
                if (!run) {
                    failures.push(`${script.title}：缺少生产运行记录`);
                    continue;
                }
                try {
                    await startSmartFilmProductionStage(batch.id, run.id, "storyboard");
                } catch (error) {
                    autoStartedStoryboardRunsRef.current.delete(script.id);
                    failures.push(`${script.title}：${error instanceof Error ? error.message : "启动失败"}`);
                }
            }
            if (failures.length) message.warning(`分镜生成自动启动失败：${failures.slice(0, 3).join("；")}`);
            else message.success("资产已确认，分镜提示词已自动开始生成");
            const latest = await getSmartFilmBatch(batch.id);
            updateBatch(latest.batch);
        })();
    }, [storyboardAutoStartKey, batch?.id, runsByScript, message, updateBatch]);

    const runProjectRecovery = async (script: SmartFilmScript, mode: SmartFilmRecoveryMode) => {
        if (!batch || busy) return;
        const run = runsByScript.get(script.id);
        if (!run) return;
        const stage = smartFilmRecoveryStage(run.failedStep);
        if (!stage) return message.warning("当前失败发生在项目创建阶段，请使用生成记录中的修复入口");
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
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    if (batchQuery.isLoading) {
        return (
            <WorkspacePage className="smart-film-page">
                <div className="smart-film-generating">
                    <LoaderCircle className="size-7 animate-spin" />
                    <strong>正在读取多剧本项目…</strong>
                </div>
            </WorkspacePage>
        );
    }
    if (batchQuery.isError && !batch) {
        return (
            <WorkspacePage className="smart-film-page">
                <div className="smart-film-script-empty" role="alert">
                    <strong>生成记录读取失败</strong>
                    <span>当前无法连接项目服务，这条记录没有被删除。</span>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Button loading={batchQuery.isFetching} onClick={() => void batchQuery.refetch()}>
                            重新读取
                        </Button>
                        <Button onClick={() => navigate("/smart-film/batches")}>返回生成记录</Button>
                    </div>
                </div>
            </WorkspacePage>
        );
    }
    if (!batch) {
        return (
            <WorkspacePage className="smart-film-page">
                <div className="smart-film-script-empty">
                    <strong>没有找到这条生成记录</strong>
                    <span>它可能已被删除，或者不属于当前账号。</span>
                    <Button onClick={() => navigate("/smart-film/batches")}>返回剧本记录</Button>
                </div>
            </WorkspacePage>
        );
    }

    return (
        <WorkspacePage className="smart-film-page smart-film-batch-page">
            <SmartFilmBatchDetailHero
                title={batch.title}
                sourceText={batch.sourceText}
                projectCount={projectScripts.length}
                onViewProjects={() => navigate(`/projects?batch=${encodeURIComponent(batch.id)}`)}
                onBackProjects={() => navigate("/projects")}
            />

            <div className="smart-film-batch-detail">
                <section className="smart-film-batch-summary">
                    <div>
                        <h2>每条剧本都是独立视频</h2>
                        <p>{busy || "选择剧本后分别创建项目；系统会分析所需资产并生成可修改的资产提示词。"}</p>
                        <p>
                            {batchSpec}
                            {batch.config.skillSnapshot ? ` · 技能：${batch.config.skillSnapshot.name} · 路由：${batch.config.skillSnapshot.routingMode === "manifest" ? "技能声明" : "自动固化"}` : " · 技能：平台默认"}
                        </p>
                    </div>
                    <div className="smart-film-batch-summary-stats">
                        <div>
                            <span>剧本</span>
                            <strong>{batch.scripts.length}</strong>
                        </div>
                        <div>
                            <span>已建项目</span>
                            <strong>{projectScripts.length}</strong>
                        </div>
                        <div>
                            <span>参考图</span>
                            <strong>{batch.inputAssetIds.length}</strong>
                        </div>
                        <div>
                            <span>积分估算</span>
                            <strong>{productionCostLabel}</strong>
                            {batchCostQuery.data?.enabled && batch.config.productionMode ? <small>含已占用 {batchCostQuery.data.committedPoints} 积分</small> : null}
                        </div>
                    </div>
                </section>

                <SmartFilmBatchProductionConfig
                    batch={batch}
                    effectiveVideoModel={effectiveConfig.videoModel}
                    currentSkillSnapshot={currentSkillSnapshot}
                    productionLocked={productionLocked}
                    skillDirty={skillDirty}
                    skillDraftId={skillDraftId}
                    skillsLoading={skillsLoading}
                    skillSaving={skillSaving}
                    busy={busy}
                    productionSaving={productionSaving}
                    skillOptions={skillOptions}
                    productionConfigValid={productionConfigValid}
                    productionDraftMatchesSaved={productionDraftMatchesSaved}
                    productionModeDraft={productionModeDraft}
                    shotCountDraft={shotCountDraft}
                    shotDurationsDraft={shotDurationsDraft}
                    productionMaxClipSeconds={productionMaxClipSeconds}
                    productionDurationOptions={productionDurationOptions}
                    targetDurationDraft={targetDurationDraft}
                    productionMaxTargetSeconds={productionMaxTargetSeconds}
                    onSkillDraftChange={setSkillDraftId}
                    onApplySkill={() => void applyBatchSkill()}
                    onManageSkills={() => navigate("/skills")}
                    onProductionModeChange={setProductionModeDraft}
                    onShotCountChange={setShotCountDraft}
                    onShotDurationChange={(index, value) => setShotDurationsDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)))}
                    onTargetDurationChange={setTargetDurationDraft}
                />

                <div className="smart-film-batch-toolbar">
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={Boolean(batch.scripts.length) && selectedScripts.length === batch.scripts.length}
                            indeterminate={selectedScripts.length > 0 && selectedScripts.length < batch.scripts.length}
                            onChange={(event) => setSelected(event.target.checked ? new Set(batch.scripts.map((script) => script.id)) : new Set())}
                        >
                            选择全部剧本
                        </Checkbox>
                        <span className="text-xs text-foreground/45">已选 {selectedScripts.length} 条</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {!batch.scripts.length ? (
                            <Button icon={<Sparkles className="size-4" />} loading={Boolean(busy)} onClick={() => void generateMissingScripts()}>
                                生成剧本
                            </Button>
                        ) : null}
                        {recoverableScripts.length ? (
                            <Button danger icon={<RefreshCcw className="size-4" />} disabled={Boolean(busy)} onClick={() => void retryFailedRuns()}>
                                修复项目创建（{recoverableScripts.length}）
                            </Button>
                        ) : null}
                        <Button icon={<Columns3 className="size-4" />} disabled={!canCompareSmartFilmScripts(selectedScripts) || Boolean(busy)} onClick={() => setComparisonOpen(true)}>
                            对比剧本
                        </Button>
                        <Tooltip title={createProjectHint}>
                            <span className="inline-flex">
                                <Button type="primary" icon={<Play className="size-4" />} disabled={!selectedDraftCount || Boolean(busy) || productionSaving || !productionConfigValid || !productionDraftMatchesSaved} onClick={() => void confirmSelected()}>
                                    创建独立视频项目
                                </Button>
                            </span>
                        </Tooltip>
                    </div>
                </div>

                {visibleScriptGenerationError ? (
                    <div className="smart-film-script-generation-error" role="alert">
                        <CircleAlert className="size-4 shrink-0" />
                        <div>
                            <strong>剧本没有生成成功</strong>
                            <span>{visibleScriptGenerationError}</span>
                        </div>
                    </div>
                ) : null}

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
                                        <Tag color={smartFilmScriptStatusColor(script.status)}>{statusCopy[script.status] || script.status}</Tag>
                                    </header>
                                    <p>{script.content}</p>
                                    {runsByScript.get(script.id) ? (
                                        <div className="mt-2 flex flex-wrap items-center gap-1">
                                            <Tag bordered={false}>
                                                资产分析：{stageStatusCopy[runsByScript.get(script.id)!.assetStatus]}
                                                {runsByScript.get(script.id)!.assetCount ? ` · ${runsByScript.get(script.id)!.assetCount} 个` : ""}
                                            </Tag>
                                            <Tag bordered={false}>
                                                分镜生成：{stageStatusCopy[runsByScript.get(script.id)!.storyboardStatus]}
                                                {runsByScript.get(script.id)!.storyboardShotCount ? ` · ${runsByScript.get(script.id)!.storyboardShotCount} 镜` : ""}
                                            </Tag>
                                        </div>
                                    ) : null}
                                    {script.error || runsByScript.get(script.id)?.error ? (
                                        <div className="smart-film-script-error">{script.error || `创建中断（${runsByScript.get(script.id)?.failedStep || "未知步骤"}）：${runsByScript.get(script.id)?.error}`}</div>
                                    ) : null}
                                    {smartFilmRecoveryStage(runsByScript.get(script.id)?.failedStep) ? (
                                        <div className="smart-film-recovery-hint">
                                            <span>重试并优先复用：有可复用结果时直接继续，否则提交新任务。</span>
                                            <span>重新生成：新建模型任务，可能产生费用。</span>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="smart-film-script-actions">
                                    <Button size="small" icon={<Edit3 className="size-3.5" />} onClick={() => openEditor(script)}>
                                        修改
                                    </Button>
                                    {!script.projectId ? (
                                        <Button size="small" icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void regenerateScript(script)}>
                                            重新生成
                                        </Button>
                                    ) : null}
                                    {!script.projectId ? (
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void deleteScript(script)}>
                                            删除
                                        </Button>
                                    ) : null}
                                    {script.projectId && script.unitId ? (
                                        <>
                                            {script.status === "project_created" ? (
                                                runsByScript.get(script.id)?.assetStatus === "queued" || runsByScript.get(script.id)?.assetStatus === "running" ? (
                                                    <Button size="small" loading disabled>
                                                        资产分析中
                                                    </Button>
                                                ) : null
                                            ) : null}
                                            {script.status === "assets_extracted" && runsByScript.get(script.id)?.assetStatus !== "confirmed" ? (
                                                <Button size="small" type="primary" icon={<CheckCircle2 className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/assets`)}>
                                                    确认资产与资产图
                                                </Button>
                                            ) : null}
                                            {script.status === "assets_extracted" && runsByScript.get(script.id)?.assetStatus === "confirmed" ? (
                                                runsByScript.get(script.id)?.storyboardStatus === "queued" || runsByScript.get(script.id)?.storyboardStatus === "running" ? (
                                                    <Button size="small" loading disabled>
                                                        分镜提示词生成中
                                                    </Button>
                                                ) : null
                                            ) : null}
                                            {script.status === "storyboard_ready" ? (
                                                <Button size="small" type="primary" icon={<Clapperboard className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/workflow/${script.unitId}/storyboard`)}>
                                                    查看分镜
                                                </Button>
                                            ) : null}
                                            <Button size="small" icon={<CheckCircle2 className="size-3.5" />} onClick={() => navigate(`/projects/${script.projectId}/overview`)}>
                                                查看项目
                                            </Button>
                                            {(runsByScript.get(script.id)?.status === "needs_attention" || script.status === "needs_attention") && smartFilmRecoveryStage(runsByScript.get(script.id)?.failedStep) ? (
                                                <>
                                                    <Button size="small" icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => void retryProject(script)}>
                                                        重试并优先复用
                                                    </Button>
                                                    <Button size="small" danger icon={<RefreshCcw className="size-3.5" />} disabled={Boolean(busy)} onClick={() => regenerateProject(script)}>
                                                        重新生成
                                                    </Button>
                                                </>
                                            ) : null}
                                        </>
                                    ) : null}
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <SmartFilmBatchScriptEmptyState
                        batch={batch}
                        quoteText={scriptGenerationQuoteText}
                        busy={busy}
                        onGenerate={() => void generateMissingScripts()}
                        onRecover={() => void recoverMissingScripts()}
                    />
                )}
            </div>
            <SmartFilmBatchScriptEditDialog
                open={Boolean(editing)}
                title={draftTitle}
                content={draftContent}
                busy={busy}
                onTitleChange={setDraftTitle}
                onContentChange={setDraftContent}
                onClose={() => setEditing(null)}
                onSave={() => void saveEditor()}
            />
            <SmartFilmScriptComparisonDialog open={comparisonOpen} scripts={selectedScripts} onClose={() => setComparisonOpen(false)} />
        </WorkspacePage>
    );
}
