import type { SmartFilmScriptReference } from "@/lib/canvas/smart-film-scripts";
import {
    deleteSmartFilmBatchScript,
    getSmartFilmBatch,
    updateSmartFilmBatchScript,
    type SmartFilmBatch,
    type SmartFilmScript,
} from "@/services/api/smart-film-batches";
import {
    confirmProjectAssetCandidate,
    getProjectUnitWorkspace,
    listProjectAssetCandidates,
    saveProjectShot,
    updateProjectUnit,
    type ProjectAssetCandidate,
} from "@/services/api/projects";
import type { AiConfig } from "@/stores/use-config-store";
import { generateSmartFilmScripts } from "./smart-film-script-generation";
import { applySmartFilmCreativeRequirement, shotConfirmationInput, smartFilmBulkTitle } from "./batch-bulk-operations";

type BatchMessage = {
    success: (content: string) => void;
    warning: (content: string) => void;
    error: (content: string) => void;
};

type BulkActionsInput = {
    batch: SmartFilmBatch | undefined;
    selectedScripts: SmartFilmScript[];
    effectiveConfig: AiConfig;
    scriptReferences: SmartFilmScriptReference[];
    message: BatchMessage;
    setBusy: (value: string) => void;
    updateBatch: (batch: SmartFilmBatch) => void;
    refresh: () => Promise<void>;
};

export function useSmartFilmBatchBulkActions(input: BulkActionsInput) {
    const { batch, selectedScripts, effectiveConfig, scriptReferences, message, setBusy, updateBatch, refresh } = input;

    const runBulkTitle = async (template: string, appendIndex: boolean) => {
        if (!batch) return;
        const targets = [...selectedScripts];
        if (!targets.length) return message.warning("请先选择剧本");
        setBusy(`正在批量修改 ${targets.length} 条剧本标题…`);
        let working = batch;
        const failures: string[] = [];
        let succeeded = 0;
        try {
            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                const current = working.scripts.find((script) => script.id === target.id);
                if (!current) {
                    failures.push(`${target.title}：剧本已不存在`);
                    continue;
                }
                const nextTitle = smartFilmBulkTitle(template, index, targets.length, appendIndex);
                if (!nextTitle) {
                    failures.push(`${current.title}：标题不能为空`);
                    continue;
                }
                if (nextTitle === current.title) {
                    succeeded += 1;
                    continue;
                }
                try {
                    if (current.projectId && current.unitId) {
                        await updateProjectUnit(current.projectId, current.unitId, { title: nextTitle, sourceText: current.content });
                    }
                    const result = await updateSmartFilmBatchScript(working.id, current.id, {
                        title: nextTitle,
                        content: current.content,
                        status: current.status,
                        expectedRevision: working.revision,
                        expectedScriptRevision: current.revision,
                    });
                    working = result.batch;
                    updateBatch(working);
                    succeeded += 1;
                } catch (error) {
                    failures.push(`${current.title}：${errorMessage(error)}`);
                }
            }
            await refresh();
            reportBulkResult(message, succeeded, failures, "条剧本标题已更新", "条剧本标题修改失败");
        } catch (error) {
            message.error(errorMessage(error, "批量修改标题失败"));
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const runBulkCreativeRequirement = async (requirement: string) => {
        if (!batch) return;
        const targets = [...selectedScripts];
        if (!targets.length) return message.warning("请先选择剧本");
        setBusy(`正在为 ${targets.length} 条剧本应用创意要求…`);
        let working = batch;
        const failures: string[] = [];
        let succeeded = 0;
        try {
            for (const target of targets) {
                const current = working.scripts.find((script) => script.id === target.id);
                if (!current) {
                    failures.push(`${target.title}：剧本已不存在`);
                    continue;
                }
                const nextContent = applySmartFilmCreativeRequirement(current.content, requirement);
                if (nextContent === current.content) {
                    succeeded += 1;
                    continue;
                }
                try {
                    if (current.projectId && current.unitId) {
                        await updateProjectUnit(current.projectId, current.unitId, { title: current.title, sourceText: nextContent });
                    }
                    const result = await updateSmartFilmBatchScript(working.id, current.id, {
                        title: current.title,
                        content: nextContent,
                        status: current.status,
                        expectedRevision: working.revision,
                        expectedScriptRevision: current.revision,
                    });
                    working = result.batch;
                    updateBatch(working);
                    succeeded += 1;
                } catch (error) {
                    failures.push(`${current.title}：${errorMessage(error)}`);
                }
            }
            await refresh();
            reportBulkResult(message, succeeded, failures, "条剧本已应用创意要求", "条剧本应用创意要求失败");
        } catch (error) {
            message.error(errorMessage(error, "批量应用创意要求失败"));
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const runBulkRegenerate = async () => {
        if (!batch) return;
        const targets = selectedScripts.filter((script) => !script.projectId);
        if (!targets.length) return message.warning("选中项里没有可重新生成的剧本草稿");
        setBusy(`正在重新生成 ${targets.length} 条剧本草稿…`);
        let working = batch;
        const failures: string[] = [];
        let succeeded = 0;
        try {
            for (const target of targets) {
                const current = working.scripts.find((script) => script.id === target.id);
                if (!current || current.projectId) {
                    failures.push(`${target.title}：剧本已创建项目或不存在`);
                    continue;
                }
                try {
                    const index = working.scripts.findIndex((script) => script.id === current.id) + 1;
                    const generated = await generateSmartFilmScripts({
                        idea: working.sourceText,
                        references: scriptReferences,
                        count: 1,
                        shotCount: working.config.shotCount || undefined,
                        shotDurationSeconds: working.config.shotDurationSeconds || undefined,
                        config: modelConfig(working, effectiveConfig),
                        batchId: working.id,
                        existingTitles: working.scripts.filter((script) => script.id !== current.id).map((script) => script.title),
                        regenerateIndex: index,
                    });
                    const next = generated.scripts[0];
                    if (!next) throw new Error("模型没有返回有效剧本");
                    const result = await updateSmartFilmBatchScript(working.id, current.id, {
                        title: next.title,
                        content: next.content,
                        status: "draft",
                        taskId: generated.taskId,
                        expectedRevision: working.revision,
                        expectedScriptRevision: current.revision,
                    });
                    working = result.batch;
                    updateBatch(working);
                    succeeded += 1;
                } catch (error) {
                    failures.push(`${current.title}：${errorMessage(error)}`);
                }
            }
            await refresh();
            reportBulkResult(message, succeeded, failures, "条剧本已重新生成", "条剧本重新生成失败");
        } catch (error) {
            message.error(errorMessage(error, "批量重新生成失败"));
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const runBulkDelete = async () => {
        if (!batch) return;
        const targets = selectedScripts.filter((script) => !script.projectId);
        if (!targets.length) return message.warning("选中项里没有可删除的剧本草稿");
        setBusy(`正在删除 ${targets.length} 条剧本草稿…`);
        let working = batch;
        const failures: string[] = [];
        let succeeded = 0;
        try {
            for (const target of targets) {
                const current = working.scripts.find((script) => script.id === target.id);
                if (!current || current.projectId) {
                    failures.push(`${target.title}：剧本已创建项目或不存在`);
                    continue;
                }
                try {
                    const result = await deleteSmartFilmBatchScript(working.id, current.id, working.revision);
                    working = result.batch;
                    updateBatch(working);
                    succeeded += 1;
                } catch (error) {
                    failures.push(`${current.title}：${errorMessage(error)}`);
                }
            }
            await refresh();
            reportBulkResult(message, succeeded, failures, "条剧本草稿已删除", "条剧本草稿删除失败");
        } catch (error) {
            message.error(errorMessage(error, "批量删除草稿失败"));
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const runBulkConfirmAssets = async () => {
        if (!batch) return;
        const targets = selectedScripts.filter((script) => {
            const run = batch.productionRuns.find((item) => item.scriptId === script.id && item.status !== "archived");
            return Boolean(script.projectId) && run?.assetStatus === "ready";
        });
        if (!targets.length) return message.warning("选中项里没有已创建项目的剧本");
        setBusy(`正在确认 ${targets.length} 个项目的资产…`);
        let working = batch;
        const failures: string[] = [];
        let succeeded = 0;
        let confirmedCandidates = 0;
        try {
            for (const target of targets) {
                const current = working.scripts.find((script) => script.id === target.id);
                const run = working.productionRuns.find((item) => item.scriptId === target.id && item.status !== "archived");
                if (!current?.projectId || !current.unitId || !run) {
                    failures.push(`${target.title}：项目或生产运行不存在`);
                    continue;
                }
                try {
                    const candidates = await listAllPendingAssetCandidates(current.projectId, current.unitId);
                    for (const candidate of candidates) {
                        await confirmProjectAssetCandidate(current.projectId, candidate.id);
                    }
                    confirmedCandidates += candidates.length;
                    succeeded += 1;
                } catch (error) {
                    failures.push(`${current.title}：${errorMessage(error)}`);
                }
            }
            const latest = await getSmartFilmBatch(working.id);
            updateBatch(latest.batch);
            await refresh();
            const suffix = confirmedCandidates ? `，共确认 ${confirmedCandidates} 个资产候选` : "";
            reportBulkResult(message, succeeded, failures, `个项目资产已确认${suffix}`, "个项目资产确认失败");
        } catch (error) {
            message.error(errorMessage(error, "批量确认资产失败"));
            await refresh();
        } finally {
            setBusy("");
        }
    };

    const runBulkConfirmStoryboard = async () => {
        if (!batch) return;
        const targets = selectedScripts.filter((script) => {
            const run = batch.productionRuns.find((item) => item.scriptId === script.id && item.status !== "archived");
            return script.status === "storyboard_ready" && Boolean(script.projectId && script.unitId) && run?.storyboardStatus === "ready";
        });
        if (!targets.length) return message.warning("选中项里没有可分镜确认的项目");
        setBusy(`正在确认 ${targets.length} 个项目的分镜提示词…`);
        const failures: string[] = [];
        let succeeded = 0;
        let confirmedShots = 0;
        try {
            for (const target of targets) {
                const current = batch.scripts.find((script) => script.id === target.id);
                if (!current?.projectId || !current.unitId) {
                    failures.push(`${target.title}：项目信息不完整`);
                    continue;
                }
                try {
                    const workspace = await getProjectUnitWorkspace(current.projectId, current.unitId);
                    if (!workspace.shots.length) throw new Error("当前项目没有可分镜确认的镜头");
                    let projectConfirmed = 0;
                    for (const shot of workspace.shots) {
                        if (shot.status === "confirmed") continue;
                        const revision = workspace.shotRevisions.find((item) => item.id === shot.currentRevisionId);
                        if (!revision) throw new Error(`镜头「${shot.title}」缺少当前版本`);
                        await saveProjectShot(current.projectId, {
                            id: shot.id,
                            unitId: current.unitId,
                            title: shot.title,
                            description: revision.plotDescription || shot.description,
                            position: shot.position,
                            durationMs: shot.durationMs,
                            status: "confirmed",
                            revision: shotConfirmationInput(shot, revision),
                        });
                        projectConfirmed += 1;
                    }
                    confirmedShots += projectConfirmed;
                    succeeded += 1;
                } catch (error) {
                    failures.push(`${current.title}：${errorMessage(error)}`);
                }
            }
            await refresh();
            const suffix = confirmedShots ? `，共确认 ${confirmedShots} 个镜头` : "";
            reportBulkResult(message, succeeded, failures, `个项目分镜已确认${suffix}`, "个项目分镜确认失败");
        } catch (error) {
            message.error(errorMessage(error, "批量确认分镜失败"));
            await refresh();
        } finally {
            setBusy("");
        }
    };

    return {
        runBulkTitle,
        runBulkCreativeRequirement,
        runBulkRegenerate,
        runBulkDelete,
        runBulkConfirmAssets,
        runBulkConfirmStoryboard,
    };
}

async function listAllPendingAssetCandidates(projectId: string, unitId: string) {
    const pageSize = 200;
    const first = await listProjectAssetCandidates(projectId, { page: 1, pageSize, unitId, status: "pending_confirmation" });
    const candidates: ProjectAssetCandidate[] = [...first.candidates];
    const pageCount = Math.ceil(first.total / Math.max(first.pageSize, 1));
    for (let page = 2; page <= pageCount; page += 1) {
        const next = await listProjectAssetCandidates(projectId, { page, pageSize, unitId, status: "pending_confirmation" });
        candidates.push(...next.candidates);
    }
    return candidates;
}

function modelConfig(batch: SmartFilmBatch, effectiveConfig: AiConfig): AiConfig {
    const textModel = batch.config.defaultTextModel || effectiveConfig.textModel;
    return { ...effectiveConfig, model: textModel, textModel, imageModel: batch.config.defaultImageModel || effectiveConfig.imageModel, videoModel: batch.config.defaultVideoModel || effectiveConfig.videoModel };
}

function reportBulkResult(message: BatchMessage, succeeded: number, failures: string[], successSuffix: string, failureSuffix: string) {
    if (!failures.length) {
        message.success(`${succeeded} ${successSuffix}`);
        return;
    }
    message.warning(`${succeeded} ${successSuffix}，${failures.length} ${failureSuffix}：${failures.slice(0, 3).join("；")}`);
}

function errorMessage(error: unknown, fallback = "操作失败") {
    return error instanceof Error ? error.message : fallback;
}
