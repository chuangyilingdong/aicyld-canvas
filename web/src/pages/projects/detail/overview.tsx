import { ArrowRight, BookOpenText, CheckCircle2, Clapperboard, Film, PackageCheck, PlaySquare, UsersRound } from "lucide-react";
import { Link } from "react-router";

import type { ProjectOverview } from "@/services/api/projects";
import { projectOverviewStageStates, type ProjectOverviewStageState } from "@/lib/project-workbench";

import type { ProjectDetailViewProps } from "./shared";

export default function ProjectOverviewView({ detail, overview }: ProjectDetailViewProps & { overview: ProjectOverview }) {
    const { project } = detail;
    const metrics = overview.metrics;
    const firstUnitId = detail.units.slice().sort((left, right) => left.position - right.position)[0]?.id || overview.units[0]?.unit.id;
    const workflowHref = (targetStage: string) => firstUnitId ? `/projects/${project.id}/workflow/${firstUnitId}/${targetStage}` : `/projects/${project.id}/chapters`;
    const stageStates = projectOverviewStageStates(metrics);
    const deliveryReady = stageStates.delivery === "completed";
    const productionSteps = [
        { id: "story", icon: BookOpenText, label: "剧情章节", description: "导入或编写正文，确认每章叙事目标", metric: `${metrics.unitCount} 章 · ${formatCompactCount(metrics.totalWordCount)} 字`, href: `/projects/${project.id}/chapters`, state: stageStates.story },
        { id: "assets", icon: UsersRound, label: "角色与资产", description: "确认角色、场景、道具和项目画风", metric: metrics.pendingCandidateCount ? `${metrics.pendingCandidateCount} 项待确认` : `${metrics.assetCount} 项资产`, href: `/projects/${project.id}/assets`, state: stageStates.assets },
        { id: "storyboard", icon: Clapperboard, label: "分镜脚本与画面", description: "拆分镜头并确认构图、对白和时长", metric: `${metrics.shotCount} 镜 · ${metrics.readyStoryboardCount} 张图`, href: workflowHref("storyboard"), state: stageStates.storyboard },
        { id: "previz", icon: PlaySquare, label: "动作预演", description: "检查表演节拍、运镜和连续性", metric: `${metrics.readyPrevizCount}/${metrics.shotCount || 0} 镜`, href: workflowHref("previz"), state: stageStates.previz },
        { id: "video", icon: Film, label: "镜头视频", description: "逐镜生成、筛选版本并锁定成片", metric: `${metrics.readyVideoCount}/${metrics.shotCount || 0} 镜`, href: workflowHref("video"), state: stageStates.video },
        { id: "delivery", icon: PackageCheck, label: "交付与打包", description: "检查缺失镜头并整理最终产物", metric: deliveryReady ? "可以交付" : metrics.shotCount ? `还差 ${Math.max(0, metrics.shotCount - metrics.readyVideoCount)} 镜` : "等待视频产物", href: workflowHref("delivery"), state: stageStates.delivery },
    ];
    const completedStageCount = productionSteps.filter((step) => step.state === "completed").length;

    return (
        <section className="project-standard-flow project-standard-flow-sole">
            <div className="project-standard-flow-head">
                <div>
                    <span>制作流程</span>
                    <h2>按顺序完成每一阶段</h2>
                    <p>每一张卡片只对应一个工作区。点击需要处理的阶段进入，不再同时提供两套流程入口。</p>
                </div>
                <span className="project-standard-flow-total">{completedStageCount}/{productionSteps.length} 个阶段已完成</span>
            </div>
            <div className="project-standard-flow-track">
                {productionSteps.map((step, index) => {
                    const Icon = step.icon;
                    return (
                        <Link key={step.id} to={step.href} className={`is-${step.state}`}>
                            <span className="project-standard-flow-index">{step.state === "completed" ? <CheckCircle2 /> : index + 1}</span>
                            <span className="project-standard-flow-icon"><Icon /></span>
                            <strong>{step.label}</strong>
                            <p>{step.description}</p>
                            <em>{step.metric}</em>
                            <span className="project-standard-flow-state">{stageStateLabel(step.state)}</span>
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

function stageStateLabel(state: ProjectOverviewStageState) {
    if (state === "completed") return "已完成";
    if (state === "attention") return "待处理";
    if (state === "active") return "进行中";
    return "未开始";
}
