import { Alert, App, Button, Form, Input, Modal, Skeleton } from "antd";
import { CheckCircle2, FileCode2, FileText, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { ReviewSummary, SubmissionStatusIcon } from "@/pages/skills/skill-publishing-panel";
import {
    getSkillReviewFile,
    listSkillReviewFiles,
    listSkillReviewQueue,
    reviewSkillSubmission,
    type SkillPackageFile,
    type SkillPackageFileContent,
    type SkillReviewTrial,
    type SkillSubmission,
} from "@/services/api/skills";

type ReviewFormValues = {
    reason: string;
    scenario: string;
    target: string;
    runtimeVersion: string;
    model: string;
    testedAt: string;
};

const queueOptions = [
    { value: "in_review", label: "待审核" },
    { value: "rejected", label: "已退回" },
    { value: "published", label: "已公开" },
];

export function SkillReviewPanel({ open, onClose, onReviewed }: { open: boolean; onClose: () => void; onReviewed: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<ReviewFormValues>();
    const [status, setStatus] = useState("in_review");
    const [items, setItems] = useState<SkillSubmission[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [files, setFiles] = useState<SkillPackageFile[]>([]);
    const [activePath, setActivePath] = useState("");
    const [content, setContent] = useState<SkillPackageFileContent | null>(null);
    const [loading, setLoading] = useState(false);
    const [filesLoading, setFilesLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async (nextStatus = status) => {
        setLoading(true);
        setError("");
        try {
            const result = await listSkillReviewQueue(nextStatus as "in_review" | "rejected" | "published");
            setItems(result.items);
            setSelectedId((current) => result.items.some((item) => item.submissionId === current) ? current : result.items[0]?.submissionId || "");
        } catch (cause) {
            setItems([]);
            setError(cause instanceof Error ? cause.message : "审核队列加载失败");
        } finally {
            setLoading(false);
        }
    }, [status]);

    useEffect(() => {
        if (!open) return;
        void load(status);
    }, [load, open, status]);

    const selected = items.find((item) => item.submissionId === selectedId) || items[0];

    useEffect(() => {
        if (!selected) {
            setFiles([]);
            setContent(null);
            return;
        }
        let cancelled = false;
        setFilesLoading(true);
        listSkillReviewFiles(selected.submissionId)
            .then((result) => {
                if (cancelled) return;
                setFiles(result.files);
                setActivePath(result.files.find((file) => file.path === "SKILL.md")?.path || result.files[0]?.path || "");
            })
            .catch((cause) => {
                if (cancelled) return;
                setFiles([]);
                setActivePath("");
                setError(cause instanceof Error ? cause.message : "投稿文件加载失败");
            })
            .finally(() => { if (!cancelled) setFilesLoading(false); });
        form.setFieldsValue({
            reason: "",
            scenario: "normal",
            target: "canvas",
            runtimeVersion: "AICYLD Canvas",
            model: "",
            testedAt: toDateTimeLocal(new Date()),
        });
        return () => { cancelled = true; };
    }, [form, selected?.submissionId]);

    useEffect(() => {
        if (!selected || !activePath) {
            setContent(null);
            return;
        }
        let cancelled = false;
        getSkillReviewFile(selected.submissionId, activePath)
            .then((result) => { if (!cancelled) setContent(result.file); })
            .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "文件读取失败"); });
        return () => { cancelled = true; };
    }, [activePath, selected?.submissionId]);

    const review = async (decision: "approve" | "reject") => {
        if (!selected) return;
        setBusy(true);
        setError("");
        try {
            const values = decision === "reject"
                ? { ...form.getFieldsValue(), reason: form.getFieldValue("reason") } as ReviewFormValues
                : await form.validateFields();
            const reason = values.reason?.trim() || "";
            if (decision === "reject" && !reason) throw new Error("退回投稿时必须填写审核意见");
            const summary = decision === "approve" ? { trials: [{
                scenario: values.scenario?.trim() || "normal",
                target: values.target?.trim() || "canvas",
                runtimeVersion: values.runtimeVersion?.trim() || "AICYLD Canvas",
                model: values.model?.trim() || "",
                conclusion: "passed" as const,
                testedAt: new Date(values.testedAt).toISOString(),
            } satisfies SkillReviewTrial] } : undefined;
            await reviewSkillSubmission(selected.submissionId, {
                decision,
                reason,
                summary,
            });
            message.success(decision === "approve" ? "审核通过，技能已公开发布" : "已退回投稿");
            await load(status);
            onReviewed();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "审核操作未完成");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={open} width="86vw" footer={null} destroyOnHidden title="技能投稿审核台" onCancel={onClose} styles={{ body: { maxHeight: "82vh", overflow: "hidden" } }}>
            <div className="skill-review-panel">
                <header className="skill-review-toolbar">
                    <SegmentedControl value={status} options={queueOptions} onChange={(value) => { setStatus(value); setSelectedId(""); }} />
                    <Button onClick={() => void load(status)} loading={loading}>刷新队列</Button>
                </header>
                {error ? <Alert type="error" title={error} /> : null}
                {loading && !items.length ? <Skeleton active paragraph={{ rows: 10 }} /> : items.length ? (
                    <div className="skill-review-layout">
                        <nav className="skill-review-queue" aria-label="投稿审核队列">
                            {items.map((item) => <button key={item.submissionId} type="button" aria-pressed={selected?.submissionId === item.submissionId} onClick={() => setSelectedId(item.submissionId)}>
                                <SubmissionStatusIcon status={item.status} />
                                <span><strong>{item.metadata.skillName}</strong><small>第 {item.revision} 次 · v{item.metadata.versionLabel || "1"} · {formatTime(item.submittedAt || item.createdAt)}</small></span>
                            </button>)}
                        </nav>
                        {selected ? <section className="skill-review-detail">
                            <header>
                                <div>
                                    <span className={`skill-review-badge is-${selected.status === "published" ? "success" : selected.status === "rejected" ? "danger" : "pending"}`}>{statusLabel(selected.status)}</span>
                                    <h2>{selected.metadata.skillName}</h2>
                                    <p>{selected.metadata.description}</p>
                                </div>
                                <code>{selected.contentHash}</code>
                            </header>

                            <div className="skill-review-metadata">
                                <div><span>作者</span><strong>{selected.authorId}</strong></div>
                                <div><span>分类</span><strong>{selected.metadata.tag}</strong></div>
                                <div><span>版本</span><strong>v{selected.metadata.versionLabel || "1"}</strong></div>
                                <div><span>投稿</span><strong>第 {selected.revision} 次</strong></div>
                            </div>

                            {selected.reviewReason ? <Alert type="warning" title="审核意见" description={selected.reviewReason} /> : null}
                            {selected.reviewSummary ? <ReviewSummary summary={selected.reviewSummary} /> : null}

                            <div className="skill-review-files">
                                <aside>
                                    <h3>投稿文件</h3>
                                    {filesLoading ? <Skeleton active title={false} paragraph={{ rows: 5 }} /> : files.map((file) => <button key={file.path} type="button" aria-pressed={activePath === file.path} onClick={() => setActivePath(file.path)}>
                                        {file.kind === "markdown" || file.kind === "text" ? <FileText className="size-3.5" /> : <FileCode2 className="size-3.5" />}
                                        <span>{file.path}</span>
                                    </button>)}
                                </aside>
                                <main>
                                    <h3>{activePath || "选择文件"}</h3>
                                    {content?.binary ? <p>该文件为二进制内容，不在审核台内预览。</p> : <pre>{content?.content || "正在读取…"}</pre>}
                                </main>
                            </div>

                            {selected.status === "in_review" ? <Form form={form} layout="vertical" className="skill-review-form">
                                <h3>审核结论</h3>
                                <Form.Item name="reason" label="审核意见"><Input.TextArea rows={3} maxLength={4000} placeholder="通过时可填写说明；退回时必须写明可执行的修改意见" /></Form.Item>
                                <div className="skill-review-trial-fields">
                                    <Form.Item name="scenario" label="实测场景" rules={[{ required: true }]}><Input placeholder="normal / missing_input" /></Form.Item>
                                    <Form.Item name="target" label="运行目标" rules={[{ required: true }]}><Input placeholder="canvas / assistant" /></Form.Item>
                                    <Form.Item name="runtimeVersion" label="运行版本" rules={[{ required: true }]}><Input placeholder="AICYLD Canvas 1.x" /></Form.Item>
                                    <Form.Item name="model" label="实测模型" rules={[{ required: true, message: "请填写实际使用的模型" }]}><Input placeholder="模型名称" /></Form.Item>
                                    <Form.Item name="testedAt" label="实测时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
                                </div>
                                <div className="skill-review-actions">
                                    <Button danger icon={<XCircle className="size-4" />} loading={busy} onClick={() => void review("reject")}>退回修改</Button>
                                    <Button type="primary" icon={<ShieldCheck className="size-4" />} loading={busy} onClick={() => void review("approve")}>通过并公开</Button>
                                </div>
                                <p className="skill-review-help"><CheckCircle2 className="size-3.5" />通过前请确认已在填写环境和模型中实际运行，并核对文件、素材授权和敏感信息。</p>
                            </Form> : null}
                        </section> : null}
                    </div>
                ) : <div className="skill-publishing-empty"><FileText /><h3>当前队列为空</h3><p>切换状态可查看历史审核记录。</p></div>}
            </div>
        </Modal>
    );
}

function statusLabel(status: string) {
    if (status === "in_review") return "待审核";
    if (status === "rejected") return "已退回";
    if (status === "published") return "已公开";
    return status;
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "时间未记录" : date.toLocaleString("zh-CN", { hour12: false });
}

function toDateTimeLocal(date: Date) {
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
