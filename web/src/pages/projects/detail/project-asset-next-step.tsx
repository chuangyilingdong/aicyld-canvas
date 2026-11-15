import { Button } from "antd";
import { ArrowRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router";

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
    const ready = !analysisRunning && !analysisFailed && !pendingLoading && pendingCount === 0 && hasAssets;
    const nextHref = unitId ? `/projects/${projectId}/workflow/${unitId}/storyboard` : `/projects/${projectId}/workflow`;
    const title = analysisRunning ? "正在识别剧本资产…" : analysisFailed ? "资产识别失败" : pendingCount > 0 ? `还有 ${pendingCount} 个资产待确认` : ready ? "资产已就绪" : "先准备资产";
    const detail = analysisRunning
        ? "模型正在分析剧本需要的人物、场景和道具。完成后会自动显示待确认资产，无需离开页面或重复操作。"
        : analysisFailed
          ? "资产分析没有完成，请返回批次页重试当前项目。"
          : pendingCount > 0
            ? "逐项生成并确认资产图，确认后会移入下方「已确认资产」。全部确认后，这里会出现「下一步：分镜制作」。"
            : ready
              ? "下一步：进入分镜制作，检查并修改分镜提示词，确认后再生成分镜图。"
              : "上传或引用产品、人物、场景和道具；缺失资产可先生成提示词再确认。";
    return (
        <section className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="资产制作下一步" aria-live="polite">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    {analysisRunning ? <LoaderCircle className="size-4 animate-spin text-foreground/55" /> : analysisFailed ? <TriangleAlert className="size-4 text-amber-500" /> : null}
                    <strong className="text-sm">{title}</strong>
                    {ready ? <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-emerald-500">已完成当前步骤</span> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-foreground/48">{detail}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                {ready ? (
                    <Button type="primary" icon={<ArrowRight className="size-3.5" />} onClick={() => navigate(nextHref)}>
                        下一步：分镜制作
                    </Button>
                ) : null}
                {analysisFailed && batchId ? <Button onClick={() => navigate(`/smart-film/batches/${batchId}`)}>返回批次重试</Button> : null}
                {!ready && !analysisFailed && !analysisRunning ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs text-foreground/45">
                        <span>下一步</span>
                        <ArrowRight className="size-3.5" />
                        <span className="font-medium text-foreground/65">分镜制作</span>
                        <span className="text-foreground/32">资产就绪后解锁</span>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
