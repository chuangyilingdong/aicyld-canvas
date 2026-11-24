import { Button } from "antd";
import { ArrowRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { getProjectSmartFilmRun, getSmartFilmBatch, startSmartFilmProductionStage } from "@/services/api/smart-film-batches";

export function ProjectAssetNextStep({
    projectId,
    batchId,
    unitId,
    pendingCount,
    pendingLoading,
    hasAssets,
    analysisRunning,
    analysisFailed,
}: {
    projectId: string;
    batchId?: string;
    unitId: string;
    pendingCount: number;
    pendingLoading: boolean;
    hasAssets: boolean;
    analysisRunning: boolean;
    analysisFailed: boolean;
}) {
    const navigate = useNavigate();
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState("");
    const ready = !analysisRunning && !analysisFailed && !pendingLoading;
    const nextHref = unitId ? `/projects/${projectId}/workflow/${unitId}/storyboard` : `/projects/${projectId}/workflow`;
    const title = analysisRunning
        ? "正在识别剧本资产…"
        : analysisFailed
          ? "资产识别失败"
          : pendingCount > 0
            ? `${pendingCount} 个资产将仅使用提示词`
            : ready
              ? "资产已就绪"
              : "先准备资产";
    const detail = analysisRunning
        ? "模型正在分析剧本需要的人物、场景和道具。完成后会自动显示待确认资产，无需离开页面或重复操作。"
        : analysisFailed
          ? "资产分析没有完成，请返回批次页重试当前项目。"
          : pendingCount > 0
            ? "无需生成资产图或逐项确认。点击下一步会自动开始生成分镜脚本，未生成视觉参考的资产会作为文字设定使用。"
            : ready
              ? hasAssets
                  ? "下一步将生成镜头脚本，智能成片会进入整片视频页面。"
                  : "可以不生成资产直接进入分镜。未生成资产图的角色、场景和道具会作为文字设定使用。"
              : "上传或引用产品、人物、场景和道具；也可以在资产库中忽略不需要的识别项。";
    const continueToStoryboard = async () => {
        if (starting) return;
        setStartError("");
        setStarting(true);
        try {
            let smartMode = false;
            if (batchId) {
                const [{ run }, { batch }] = await Promise.all([getProjectSmartFilmRun(projectId), getSmartFilmBatch(batchId)]);
                smartMode = batch.config.productionMode === "smart";
                if (!run.storyboardTaskId && (run.storyboardStatus === "waiting" || run.storyboardStatus === "pending")) {
                    await startSmartFilmProductionStage(batchId, run.id, "storyboard");
                }
            }
            navigate(smartMode && unitId ? `/projects/${projectId}/workflow/${unitId}/video` : nextHref);
        } catch (error) {
            setStartError(error instanceof Error ? error.message : "分镜生成启动失败，请重试");
        } finally {
            setStarting(false);
        }
    };
    return (
        <section className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="资产制作下一步" aria-live="polite">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    {analysisRunning ? <LoaderCircle className="size-4 animate-spin text-foreground/55" /> : analysisFailed ? <TriangleAlert className="size-4 text-amber-500" /> : null}
                    <strong className="text-sm">{title}</strong>
                    {ready ? <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-emerald-500">{pendingCount > 0 ? "可直接进入" : "已完成当前步骤"}</span> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-foreground/48">{detail}</p>
                {startError ? <p role="alert" className="mt-1 text-xs text-rose-500">{startError}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                {ready ? (
                    <Button type="primary" loading={starting} icon={starting ? undefined : <ArrowRight className="size-3.5" />} onClick={() => void continueToStoryboard()}>
                        {starting ? "正在启动分镜…" : "下一步：生成镜头脚本"}
                    </Button>
                ) : null}
                {analysisFailed && batchId ? <Button onClick={() => navigate(`/smart-film/batches/${batchId}`)}>返回批次重试</Button> : null}
            </div>
        </section>
    );
}
