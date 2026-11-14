import { Button, Modal, Popconfirm } from "antd";
import { Trash2 } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import type { ProjectAssetCandidate, ProjectAssetCandidatePreview } from "@/services/api/projects";

import { formatTime } from "./shared";

type Props = {
    candidate: ProjectAssetCandidate | null;
    selectingPreviewId?: string;
    deletingPreviewId?: string;
    onClose: () => void;
    onSelect: (candidate: ProjectAssetCandidate, preview: ProjectAssetCandidatePreview) => void;
    onDelete: (candidate: ProjectAssetCandidate, preview: ProjectAssetCandidatePreview) => void;
};

export function AssetCandidateHistoryModal({ candidate, selectingPreviewId, deletingPreviewId, onClose, onSelect, onDelete }: Props) {
    return (
        <Modal
            open={Boolean(candidate)}
            title={candidate ? `${candidate.name} · 资产图历史` : "资产图历史"}
            footer={null}
            width={1080}
            destroyOnHidden
            onCancel={onClose}
        >
            {candidate ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/48">
                        <span>并排比较每次生成结果，选择一张作为当前资产图；未采用的图片可以删除。</span>
                        <span>{candidate.previews?.length || 0} 个历史版本</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {(candidate.previews || []).filter((preview) => preview.status !== "deleted").map((preview) => (
                            <article key={preview.id} className={`overflow-hidden rounded-xl border ${preview.selected ? "border-[var(--workspace-accent)]" : "border-border/70"} bg-surface-active`}>
                                <div className="relative aspect-[4/3] bg-foreground/[.045]">
                                    {preview.resourceId ? (
                                        <CachedResourceImage storageKey={`resource:${preview.resourceId}`} alt={candidate.name} eager className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="grid h-full place-items-center text-xs text-foreground/38">{preview.status === "failed" ? "生成失败" : "图片尚未完成"}</div>
                                    )}
                                    {preview.selected ? <span className="absolute left-2 top-2 rounded-full bg-[var(--workspace-accent)] px-2 py-1 text-[10px] font-medium text-white">当前采用</span> : null}
                                    <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[10px] text-white">{preview.status === "ready" ? "已完成" : preview.status === "failed" ? "失败" : "生成中"}</span>
                                </div>
                                <div className="space-y-3 p-3">
                                    <div className="space-y-1 text-[11px] text-foreground/48">
                                        <div className="truncate">模型：{preview.model || "未记录"}</div>
                                        <div>费用：{preview.points || 0} 积分</div>
                                        <div className="truncate" title={preview.taskId || ""}>任务：{preview.taskId || "未记录"}</div>
                                        <div>{formatTime(preview.createdAt)}</div>
                                        {preview.error ? <div className="line-clamp-2 text-[var(--danger,#d94b4b)]">{preview.error}</div> : null}
                                    </div>
                                    <div className="flex items-center justify-end gap-1">
                                        {!preview.selected && preview.status === "ready" ? (
                                            <Button size="small" type="primary" loading={selectingPreviewId === preview.id} disabled={Boolean(deletingPreviewId)} onClick={() => onSelect(candidate, preview)}>选择采用</Button>
                                        ) : null}
                                        {!preview.selected ? (
                                            <Popconfirm title="删除这张未采用的资产图？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} disabled={preview.status === "generating"} onConfirm={() => onDelete(candidate, preview)}>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} loading={deletingPreviewId === preview.id} disabled={preview.status === "generating" || Boolean(selectingPreviewId)} aria-label="删除未采用的资产图" />
                                            </Popconfirm>
                                        ) : null}
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
