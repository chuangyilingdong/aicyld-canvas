import { useState } from "react";
import { App, Button, Pagination, Select, Tag } from "antd";
import { ArrowLeft, Clapperboard, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { deleteSmartFilmBatch, listSmartFilmBatches, type SmartFilmBatch } from "@/services/api/smart-film-batches";

import "./smart-film.css";
import "./smart-film-batch.css";

type BatchStatus = "" | "draft" | "confirmed" | "partially_confirmed";

const statusLabels: Record<Exclude<BatchStatus, "">, string> = {
    draft: "草稿",
    confirmed: "已确认",
    partially_confirmed: "部分确认",
};

export default function SmartFilmBatchListPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message, modal } = App.useApp();
    const [status, setStatus] = useState<BatchStatus>("");
    const [page, setPage] = useState(1);
    const listQuery = useQuery({
        queryKey: ["smart-film-batches", status, page],
        queryFn: () => listSmartFilmBatches({ status, page, pageSize: 20 }),
        refetchInterval: (query) => query.state.data?.batches.some((batch) => batch.control.queuedCount + batch.control.runningCount > 0) ? 3000 : false,
    });

    const deleteBatch = (batch: SmartFilmBatch) => {
        modal.confirm({
            title: `删除草稿批次「${batch.title}」？`,
            content: "只删除尚未创建项目的草稿批次，不会影响任何项目、任务或素材。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteSmartFilmBatch(batch.id);
                message.success("草稿批次已删除");
                await queryClient.invalidateQueries({ queryKey: ["smart-film-batches"] });
            },
        });
    };

    return (
        <WorkspacePage className="smart-film-page smart-film-batch-page">
            <header className="smart-film-hero">
                <div>
                    <span className="smart-film-eyebrow"><Clapperboard className="size-3.5" /> FILM BATCHES</span>
                    <h1>多剧本批次</h1>
                    <p>找回已经生成或正在后台制作的批次，继续确认资产、分镜和镜头视频。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/smart-film")}>返回智能成片</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => navigate("/smart-film/batches/new")}>新建批次</Button>
                </div>
            </header>

            <div className="smart-film-batch-detail">
                <div className="smart-film-batch-toolbar">
                    <div className="flex items-center gap-2">
                        <Select<BatchStatus>
                            value={status}
                            style={{ width: 150 }}
                            onChange={(value) => { setStatus(value); setPage(1); }}
                            options={[
                                { value: "", label: "全部状态" },
                                { value: "draft", label: "草稿" },
                                { value: "partially_confirmed", label: "部分确认" },
                                { value: "confirmed", label: "已确认" },
                            ]}
                        />
                        <span className="text-xs text-foreground/45">共 {listQuery.data?.total || 0} 个批次</span>
                    </div>
                    <Button icon={<RefreshCcw className="size-4" />} loading={listQuery.isFetching} onClick={() => void listQuery.refetch()}>刷新</Button>
                </div>

                {listQuery.isLoading ? (
                    <div className="smart-film-batch-empty">正在读取批次…</div>
                ) : !listQuery.data?.batches.length ? (
                    <div className="smart-film-script-empty">
                        <Clapperboard className="size-7 text-foreground/30" />
                        <strong>还没有符合条件的批次</strong>
                        <span>新建一个批次，让每条剧本成为独立视频项目。</span>
                        <Button type="primary" onClick={() => navigate("/smart-film/batches/new")}>新建批次</Button>
                    </div>
                ) : (
                    <div className="smart-film-batch-list-grid">
                        {listQuery.data.batches.map((batch) => {
                            const projectCount = batch.scripts.filter((script) => Boolean(script.projectId)).length;
                            const readyCount = batch.scripts.filter((script) => script.status === "storyboard_ready").length;
                            return (
                                <article className="smart-film-batch-list-card" key={batch.id}>
                                    <div className="smart-film-batch-list-card-head">
                                        <div>
                                            <span className="text-[10px] font-mono text-foreground/35">BATCH {batch.id.slice(0, 8)}</span>
                                            <h2>{batch.title}</h2>
                                        </div>
                                        <Tag color={batch.status === "confirmed" ? "green" : batch.status === "partially_confirmed" ? "blue" : "default"}>{statusLabels[batch.status]}</Tag>
                                    </div>
                                    <p>{batch.sourceText}</p>
                                    <div className="smart-film-batch-list-stats">
                                        <span><strong>{batch.scripts.length}</strong> 条剧本</span>
                                        <span><strong>{projectCount}</strong> 个项目</span>
                                        <span><strong>{readyCount}</strong> 个分镜完成</span>
                                        <span><strong>{batch.control.queuedCount + batch.control.runningCount}</strong> 个后台任务</span>
                                    </div>
                                    <div className="smart-film-batch-list-card-foot">
                                        <span>{batch.paused ? "已暂停" : batch.control.currentProjectId ? "后台处理中" : `更新于 ${new Date(batch.updatedAt).toLocaleString()}`}</span>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button size="small" type="primary" onClick={() => navigate(`/smart-film/batches/${batch.id}`)}>继续制作</Button>
                                            {batch.status === "draft" && projectCount === 0 ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteBatch(batch)}>删除</Button> : null}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}

                {(listQuery.data?.total || 0) > 20 ? <Pagination current={page} pageSize={20} total={listQuery.data?.total || 0} showSizeChanger={false} onChange={setPage} /> : null}
            </div>
        </WorkspacePage>
    );
}
