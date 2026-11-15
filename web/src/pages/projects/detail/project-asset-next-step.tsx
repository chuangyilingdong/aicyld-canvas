import { Button } from "antd";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router";

export function ProjectAssetNextStep({ projectId, unitId, pendingCount, pendingLoading, hasAssets }: {
    projectId: string;
    unitId: string;
    pendingCount: number;
    pendingLoading: boolean;
    hasAssets: boolean;
}) {
    const navigate = useNavigate();
    const ready = !pendingLoading && pendingCount === 0 && hasAssets;
    const nextHref = unitId ? `/projects/${projectId}/workflow/${unitId}/storyboard` : `/projects/${projectId}/workflow`;
    return (
        <section className="mb-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between" aria-label="资产制作下一步">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{pendingCount > 0 ? `还有 ${pendingCount} 个资产待确认` : ready ? "资产已就绪" : "先准备资产"}</strong>
                    {ready ? <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[var(--fs-tiny)] font-medium text-emerald-500">已完成当前步骤</span> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-foreground/48">
                    {pendingCount > 0
                        ? "请修改资产提示词，生成资产图并确认全部候选；资产齐备后再进入分镜。"
                        : ready
                            ? "下一步：进入分镜制作，检查并修改分镜提示词，确认后再生成分镜图。"
                            : "上传或引用产品、人物、场景和道具；缺失资产可先生成提示词再确认。"}
                </p>
            </div>
            {ready ? <Button type="primary" icon={<ArrowRight className="size-3.5" />} onClick={() => navigate(nextHref)}>下一步：分镜制作</Button> : null}
        </section>
    );
}
