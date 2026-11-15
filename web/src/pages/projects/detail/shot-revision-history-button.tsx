import { useEffect, useMemo, useState } from "react";
import { App, Button, Modal, Tag } from "antd";
import { History } from "lucide-react";

import { saveProjectShot, type ProjectDetail, type ProjectShot, type ShotRevision } from "@/services/api/projects";
import { compareShotRevisions, shotRevisionInputFromRevision } from "./shot-revision-history";
import { revisionInput } from "./workflow-production-helpers";

export function ShotRevisionHistoryButton({ detail, shot, projectId, unitId, disabled, onRestored }: {
    detail: ProjectDetail;
    shot: ProjectShot;
    projectId: string;
    unitId: string;
    disabled: boolean;
    onRestored: () => Promise<void>;
}) {
    const { message, modal } = App.useApp();
    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState("");
    const [restoring, setRestoring] = useState(false);
    const revisions = useMemo(() => (detail.shotRevisions || []).filter((item) => item.shotId === shot.id).slice().sort((left, right) => right.version - left.version), [detail.shotRevisions, shot.id]);
    const current = revisions.find((item) => item.id === shot.currentRevisionId) || revisions[0];
    const selected = revisions.find((item) => item.id === selectedId) || revisions[0];
    const fields = selected ? compareShotRevisions(current, selected) : [];

    useEffect(() => {
        if (!open) return;
        setSelectedId((revisions.find((item) => item.id !== current?.id) || revisions[0])?.id || "");
    }, [current?.id, open, revisions]);

    const restore = () => {
        if (!selected || selected.id === current?.id) return;
        modal.confirm({
            title: `回退到版本 v${selected.version}？`,
            content: "系统会把旧版提示词保存为一个新版本，并将当前分镜图和视频标记为过期。历史产物不会被删除；本次只恢复脚本字段，不恢复历史资产绑定。",
            okText: "回退并新建版本",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => restoreRevision(selected),
        });
    };

    const restoreRevision = async (revision: ShotRevision) => {
        setRestoring(true);
        try {
            await saveProjectShot(projectId, {
                id: shot.id,
                unitId,
                title: shot.title,
                description: revision.plotDescription,
                position: shot.position,
                durationMs: revision.durationMs,
                status: "draft",
                revision: revisionInput({ title: shot.title, ...shotRevisionInputFromRevision(revision) }),
            });
            await onRestored();
            setOpen(false);
            message.success(`已回退到 v${revision.version}，并创建新版本；下游产物已标记过期`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "镜头版本回退失败");
            throw error;
        } finally {
            setRestoring(false);
        }
    };

    return (
        <>
            <Button size="small" icon={<History className="size-3.5" />} disabled={disabled} onClick={() => setOpen(true)}>版本历史（{revisions.length}）</Button>
            <Modal open={open} title="镜头版本历史" width={1080} footer={null} onCancel={() => setOpen(false)} destroyOnHidden>
                <div className="shot-revision-history-layout">
                    <nav className="shot-revision-history-list" aria-label="镜头版本列表">
                        {revisions.map((revision) => (
                            <button key={revision.id} type="button" className={revision.id === selected?.id ? "is-active" : ""} onClick={() => setSelectedId(revision.id)}>
                                <span><strong>v{revision.version}</strong>{revision.id === current?.id ? <Tag color="blue">当前</Tag> : null}</span>
                                <small>{shortDate(revision.createdAt)}</small>
                                <p>{revision.plotDescription || "未填写镜头画面"}</p>
                            </button>
                        ))}
                    </nav>
                    <section className="shot-revision-history-diff">
                        <header>
                            <div><span>正在查看</span><strong>v{selected?.version} {selected?.id === current?.id ? "· 当前版本" : "· 历史版本"}</strong></div>
                            <Button type="primary" danger disabled={!selected || selected.id === current?.id || restoring} loading={restoring} onClick={restore}>回退到此版本</Button>
                        </header>
                        <div className="shot-revision-history-fields">
                            {fields.map((field) => (
                                <article key={field.key} className={field.changed ? "is-changed" : ""}>
                                    <div><span>{field.label}</span>{field.changed ? <Tag color="orange">有差异</Tag> : <Tag bordered={false}>相同</Tag>}</div>
                                    <div className="shot-revision-history-value"><small>当前</small><p>{field.current || "空"}</p></div>
                                    <div className="shot-revision-history-value"><small>v{selected?.version}</small><p>{field.selected || "空"}</p></div>
                                </article>
                            ))}
                        </div>
                    </section>
                </div>
            </Modal>
        </>
    );

}

function shortDate(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
