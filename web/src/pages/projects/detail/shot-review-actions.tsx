import { useEffect, useState } from "react";
import { App, Button, Input, Modal, Tag } from "antd";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";

import { reviewProjectShot, type ProjectShot, type ShotArtifact } from "@/services/api/projects";

export function ShotReviewActions({ projectId, shot, artifact, disabled, onReviewed, onRework }: {
    projectId: string;
    shot: ProjectShot;
    artifact?: ShotArtifact;
    disabled: boolean;
    onReviewed: () => Promise<void>;
    onRework: (note: string) => void;
}) {
    const { message } = App.useApp();
    const [rejectOpen, setRejectOpen] = useState(false);
    const [note, setNote] = useState(shot.reviewNote || "");
    const [busy, setBusy] = useState(false);
    const canReview = Boolean(artifact?.resourceId && artifact.status === "ready");
    const status = canReview ? shot.reviewStatus || "pending" : "pending";
    useEffect(() => {
        setNote(shot.reviewNote || "");
    }, [shot.id, shot.reviewNote, shot.reviewStatus]);
    const submit = async (nextStatus: "approved" | "rejected", nextNote = "") => {
        if (!shot.currentRevisionId) {
            message.warning("镜头还没有可审核的脚本版本");
            return;
        }
        setBusy(true);
        try {
            await reviewProjectShot(projectId, shot.id, { status: nextStatus, note: nextNote, expectedRevisionId: shot.currentRevisionId });
            await onReviewed();
            setRejectOpen(false);
            message.success(nextStatus === "approved" ? "镜头已通过审核" : "已记录返工意见");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "镜头审核失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="flex flex-wrap items-center gap-1">
            <Tag color={status === "approved" ? "green" : status === "rejected" ? "red" : "default"}>{status === "approved" ? "已通过" : status === "rejected" ? "需返工" : "待审核"}</Tag>
            {canReview ? <Button size="small" icon={<CheckCircle2 className="size-3.5" />} disabled={disabled || busy || status === "approved"} onClick={() => void submit("approved")}>通过</Button> : null}
            {canReview ? <Button size="small" danger icon={<XCircle className="size-3.5" />} disabled={disabled || busy} onClick={() => setRejectOpen(true)}>{status === "rejected" ? "修改意见" : "不通过"}</Button> : null}
            {status === "rejected" && shot.reviewNote ? <Button size="small" type="primary" icon={<RotateCcw className="size-3.5" />} disabled={disabled || busy} onClick={() => onRework(shot.reviewNote || "")}>按意见重新生成</Button> : null}
            {!canReview ? <span className="text-[var(--fs-micro)] text-foreground/38">生成产物后可审核</span> : null}
            <Modal title="镜头未通过审核" open={rejectOpen} okText="保存返工意见" cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: !note.trim() }} onCancel={() => { if (!busy) setRejectOpen(false); }} onOk={() => void submit("rejected", note.trim())}>
                <div className="grid gap-3 pt-2">
                    <p className="text-xs leading-5 text-foreground/50">写清人物、产品、构图、动作或画质问题。重新生成时，这条意见会写入连续性备注并随生成请求提交。</p>
                    <Input.TextArea value={note} autoSize={{ minRows: 5, maxRows: 10 }} maxLength={4000} showCount placeholder="例如：人物右手拿杯子的位置不对，产品 logo 朝向反了，请保持上一镜服装不变。" onChange={(event) => setNote(event.target.value)} />
                </div>
            </Modal>
        </div>
    );
}
