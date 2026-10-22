import { Alert, App, Button, Checkbox, Modal, Skeleton } from "antd";
import { CheckCircle2, Clock3, FileCheck2, RotateCcw, Send, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
    listSkillSubmissions,
    prepareSkillSubmission,
    submitSkillSubmission,
    withdrawSkillSubmission,
    type Skill,
    type SkillReviewSummary,
    type SkillSubmission,
} from "@/services/api/skills";

const statusCopy: Record<string, { label: string; tone: string }> = {
    draft: { label: "投稿草稿", tone: "muted" },
    pending: { label: "待准备投稿", tone: "muted" },
    in_review: { label: "审核中", tone: "pending" },
    rejected: { label: "已退回", tone: "danger" },
    published: { label: "已公开", tone: "success" },
    withdrawn: { label: "已撤回", tone: "muted" },
};

export function SkillPublishingPanel({ skill, open, onClose, onChanged }: { skill: Skill | null; open: boolean; onClose: () => void; onChanged: () => void }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<SkillSubmission[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [confirmed, setConfirmed] = useState(false);

    const load = useCallback(async () => {
        if (!skill) return;
        setLoading(true);
        setError("");
        try {
            const result = await listSkillSubmissions(skill.skillId);
            setItems(result.items);
            setSelectedId((current) => result.items.some((item) => item.submissionId === current) ? current : result.items[0]?.submissionId || "");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "投稿记录加载失败");
        } finally {
            setLoading(false);
        }
    }, [skill]);

    useEffect(() => {
        if (!open) return;
        setConfirmed(false);
        void load();
    }, [load, open]);

    useEffect(() => {
        setConfirmed(false);
    }, [selectedId]);

    const current = items.find((item) => item.submissionId === selectedId) || items[0];
    const latest = items[0];
    const review = statusCopy[skill?.reviewStatus || ""] || statusCopy.pending;
    const latestPublished = latest?.status === "published";
    const hasNewerVersion = Boolean(latestPublished && skill && skill.versionId !== latest.versionId);
    const canPrepare = Boolean(skill && skill.reviewStatus !== "in_review" && (!latestPublished || hasNewerVersion));

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        setError("");
        try {
            await work();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "操作未完成");
        } finally {
            setBusy(false);
        }
    };

    const prepare = () => {
        if (!skill) return;
        void run(async () => {
            const result = await prepareSkillSubmission(skill.skillId, skill.versionId, skill.contentHash);
            message.success("已生成私有投稿快照，请核对后确认送审");
            setSelectedId(result.submission.submissionId);
            await load();
            onChanged();
        });
    };

    const submit = () => {
        if (!skill || !current) return;
        void run(async () => {
            await submitSkillSubmission(current.submissionId, current.versionId, current.contentHash);
            message.success("已送审，审核通过后才会公开发布");
            setConfirmed(false);
            await load();
            onChanged();
        });
    };

    const withdraw = () => {
        if (!current) return;
        void run(async () => {
            await withdrawSkillSubmission(current.submissionId);
            message.success("投稿草稿已撤回");
            await load();
            onChanged();
        });
    };

    return (
        <Modal open={open} width={820} footer={null} destroyOnHidden title="技能投稿与审核状态" onCancel={onClose}>
            {loading && !items.length ? <Skeleton active paragraph={{ rows: 8 }} /> : (
                <div className="skill-publishing-panel">
                    <section className="skill-publishing-current">
                        <div>
                            <span className={`skill-review-badge is-${review.tone}`}>{review.label}</span>
                            <h2>{skill?.skillName}</h2>
                            <p>当前版本 v{skill?.version || "1"} · {skill?.contentHash.slice(0, 12)}</p>
                        </div>
                        {canPrepare ? <Button type="primary" icon={<Send className="size-4" />} loading={busy} onClick={prepare}>准备投稿</Button> : null}
                    </section>

                    {error ? <Alert type="error" title={error} /> : null}
                    {skill?.reviewStatus === "in_review" ? <Alert type="info" title="审核期间技能文件和公开信息会被锁定" description="审核结束后可在这里查看通过结果或退回意见；退回后修改技能即可生成新版本并重新投稿。" /> : null}
                    {latestPublished && !hasNewerVersion ? <Alert type="success" title="当前版本已公开发布" description="如需更新，请先编辑技能生成新版本；新版本审核期间技能会暂时下架，审核通过后重新公开。" /> : null}
                    {latest?.status === "rejected" ? <Alert type="warning" title="本次投稿已退回" description={latest.reviewReason || "请根据审核意见修改后重新投稿。"} /> : null}

                    {current ? (
                        <section className="skill-publishing-submission">
                            <header>
                                <div><h3>第 {current.revision} 次投稿</h3><p>{statusCopy[current.status]?.label || current.status} · 版本 v{current.metadata.versionLabel || skill?.version || "1"}</p></div>
                                <span className="skill-publishing-time">{current.submittedAt ? `送审于 ${formatTime(current.submittedAt)}` : `创建于 ${formatTime(current.createdAt)}`}</span>
                            </header>
                            <div className="skill-publishing-preview">
                                <div><span>技能名称</span><strong>{current.metadata.skillName}</strong></div>
                                <div><span>公开简介</span><p>{current.metadata.description}</p></div>
                                <div><span>内容摘要</span><code>{current.contentHash}</code></div>
                                <div><span>包含文件</span><strong>{skill?.fileCount || 0} 个 · {formatBytes(skill?.totalBytes || 0)}</strong></div>
                            </div>
                            {current.reviewSummary ? <ReviewSummary summary={current.reviewSummary} /> : null}
                            {current.status === "draft" ? (
                                <div className="skill-publishing-confirm">
                                    <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>我已核对文件、公开信息、素材授权和密钥，确认将以上内容提交审核。</Checkbox>
                                    <div className="skill-publishing-actions">
                                        <Button onClick={withdraw} loading={busy}>撤回草稿</Button>
                                        <Button type="primary" icon={<ShieldCheck className="size-4" />} disabled={!confirmed} loading={busy} onClick={submit}>确认送审</Button>
                                    </div>
                                </div>
                            ) : null}
                        </section>
                    ) : <div className="skill-publishing-empty"><FileCheck2 /><h3>还没有投稿记录</h3><p>先核对当前技能版本，再生成一份私有投稿快照。</p></div>}

                    {items.length > 1 ? (
                        <section>
                            <h3 className="skill-publishing-history-title">历史投稿</h3>
                            <div className="skill-publishing-history">
                                {items.map((item) => {
                                    const state = statusCopy[item.status] || statusCopy.pending;
                                    return <button key={item.submissionId} type="button" aria-pressed={current?.submissionId === item.submissionId} onClick={() => setSelectedId(item.submissionId)}>
                                        <span>第 {item.revision} 次 · v{item.metadata.versionLabel || "1"}</span>
                                        <small className={`skill-review-badge is-${state.tone}`}>{state.label}</small>
                                    </button>;
                                })}
                            </div>
                        </section>
                    ) : null}
                </div>
            )}
        </Modal>
    );
}

export function ReviewSummary({ summary }: { summary: SkillReviewSummary }) {
    return <section className="skill-review-summary" aria-label="审核实测记录">
        <h3><CheckCircle2 className="size-4" />审核实测记录</h3>
        <p>审核于 {formatTime(summary.reviewedAt)} · 第 {summary.revision} 版 · {summary.contentHash.slice(0, 12)}</p>
        <div className="skill-review-trials">
            {summary.trials.map((trial, index) => <article key={`${trial.testedAt}-${index}`}>
                <span className="skill-review-trial-result"><CheckCircle2 className="size-3.5" />{trial.conclusion === "passed" ? "通过" : "未通过"}</span>
                <strong>{scenarioLabel(trial.scenario)} · {targetLabel(trial.target)}</strong>
                <p>{trial.runtimeVersion} · {trial.model}</p>
                <time dateTime={trial.testedAt}>{formatTime(trial.testedAt)}</time>
            </article>)}
        </div>
        <small>记录只反映上述环境和模型的试用结果；更换模型、素材或运行环境后，效果可能不同。</small>
    </section>;
}

export function SubmissionStatusIcon({ status }: { status: string }) {
    if (status === "published") return <CheckCircle2 className="size-4 text-emerald-600" />;
    if (status === "rejected") return <XCircle className="size-4 text-rose-600" />;
    if (status === "in_review") return <Clock3 className="size-4 text-amber-600" />;
    if (status === "withdrawn") return <RotateCcw className="size-4 text-foreground/40" />;
    return <FileCheck2 className="size-4 text-foreground/40" />;
}

function scenarioLabel(value: string) {
    if (value === "normal") return "正常使用";
    if (value === "missing_input") return "缺少输入";
    return value || "实测样例";
}

function targetLabel(value: string) {
    if (value === "canvas") return "画布";
    if (value === "assistant") return "内置助手";
    return value;
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(value: number) {
    if (!value) return "0 B";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
