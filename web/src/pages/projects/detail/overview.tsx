import { ArrowRight, BookOpenText, CheckCircle2, Clapperboard, Film, PackageCheck, PlaySquare, UsersRound } from "lucide-react";
import { Link } from "react-router";

import type { ProjectOverview } from "@/services/api/projects";

import type { ProjectDetailViewProps } from "./shared";

export default function ProjectOverviewView({ detail, overview }: ProjectDetailViewProps & { overview: ProjectOverview }) {
    const { project } = detail;
    const metrics = overview.metrics;
    const firstUnitId = detail.units.slice().sort((left, right) => left.position - right.position)[0]?.id || overview.units[0]?.unit.id;
    const workflowHref = (targetStage: string) => firstUnitId ? `/projects/${project.id}/workflow/${firstUnitId}/${targetStage}` : `/projects/${project.id}/chapters`;
    const productionSteps = [
        { id: "story", icon: BookOpenText, label: "剧情章节", description: "导入或编写正文，确认每章叙事目标", metric: `${metrics.unitCount} 章 · ${formatCompactCount(metrics.totalWordCount)} 字`, href: `/projects/${project.id}/chapters`, complete: metrics.unitCount > 0 },
        { id: "assets", icon: UsersRound, label: "角色与资产", description: "确认角色、场景、道具和项目画风", metric: `${metrics.assetCount} 项资产`, href: `/projects/${project.id}/assets`, complete: metrics.assetCount > 0 },
        { id: "storyboard", icon: Clapperboard, label: "分镜脚本与画面", description: "拆分镜头并确认构图、对白和时长", metric: `${metrics.shotCount} 镜 · ${metrics.readyStoryboardCount} 张图`, href: workflowHref("storyboard"), complete: metrics.shotCount > 0 },
        { id: "previz", icon: PlaySquare, label: "动作预演", description: "检查表演节拍、运镜和连续性", metric: `${metrics.readyPrevizCount}/${metrics.shotCount || 0} 镜`, href: workflowHref("previz"), complete: metrics.shotCount > 0 && metrics.readyPrevizCount === metrics.shotCount },
        { id: "video", icon: Film, label: "镜头视频", description: "逐镜生成、筛选版本并锁定成片", metric: `${metrics.readyVideoCount}/${metrics.shotCount || 0} 镜`, href: workflowHref("video"), complete: metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount },
        { id: "delivery", icon: PackageCheck, label: "交付与打包", description: "检查缺失镜头并整理最终产物", metric: metrics.readyVideoCount && metrics.readyVideoCount === metrics.shotCount ? "可以交付" : `还差 ${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} 镜`, href: workflowHref("delivery"), complete: metrics.shotCount > 0 && metrics.readyVideoCount === metrics.shotCount },
    ];
    const completedStageCount = productionSteps.filter((step) => step.complete).length;

    return (
        <section className="project-standard-flow project-standard-flow-sole">
            <div className="project-standard-flow-head">
                <div>
                    <span>制作流程</span>
                    <h2>按顺序完成每一阶段</h2>
                    <p>每一张卡片只对应一个工作区。点击需要处理的阶段进入，不再同时提供两套流程入口。</p>
                </div>
                <span className="project-standard-flow-total">{completedStageCount}/{productionSteps.length} 个阶段已有内容</span>
            </div>
            <div className="project-standard-flow-track">
                {productionSteps.map((step, index) => {
                    const Icon = step.icon;
                    return (
                        <Link key={step.id} to={step.href} className={step.complete ? "is-complete" : ""}>
                            <span className="project-standard-flow-index">{step.complete ? <CheckCircle2 /> : index + 1}</span>
                            <span className="project-standard-flow-icon"><Icon /></span>
                            <strong>{step.label}</strong>
                            <p>{step.description}</p>
                            <em>{step.metric}</em>
                            <ArrowRight className="project-standard-flow-arrow" />
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}

function formatCompactCount(value: number) {
    return value >= 10_000 ? `${Math.round(value / 1_000) / 10} 万` : value.toLocaleString("zh-CN");
}
