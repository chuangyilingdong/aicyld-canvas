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
            title: `删除剧本生成记录「${batch.title}」？`,
            content: "生成记录、剧本和后台运行记录会被删除；已经创建的项目会保留并转为独立项目。生成中的记录需要等待任务结束后才能删除。",
            okText: "删除记录",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSmartFilmBatch(batch.id);
                    message.success("生成记录已删除，已有项目已保留");
                    await queryClient.invalidateQueries({ queryKey: ["smart-film-batches"] });
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "生成记录删除失败");
                    throw error;
                }
            },
        });
    };

    return (
        <WorkspacePage className="smart-film-page smart-film-batch-page">
            <header className="smart-film-hero">
                <div>
                    <span className="smart-film-eyebrow"><Clapperboard className="size-3.5" /> FILM RECORDS</span>
                    <h1>剧本生成记录</h1>
                    <p>找回已经生成或正在后台制作的多剧本记录，继续确认资产、分镜和镜头视频。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/projects")}>返回项目库</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => navigate("/smart-film/batches/new")}>新建多剧本项目</Button>
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
                        <span className="text-xs text-foreground/45">共 {listQuery.data?.total || 0} 条记录</span>
                    </div>
                    <Button icon={<RefreshCcw className="size-4" />} loading={listQuery.isFetching} onClick={() => void listQuery.refetch()}>刷新</Button>
                </div>

                {listQuery.isLoading ? (
                    <div className="smart-film-batch-empty">正在读取生成记录…</div>
                ) : listQuery.isError ? (
                    <div className="smart-film-batch-empty" role="alert">
                        <Clapperboard className="size-7 text-rose-500" />
                        <strong>生成记录读取失败</strong>
                        <span>当前无法连接项目服务，已有数据没有被删除。</span>
                        <Button loading={listQuery.isFetching} onClick={() => void listQuery.refetch()}>重新读取</Button>
                    </div>
                ) : !listQuery.data?.batches.length ? (
                    <div className="smart-film-script-empty">
                        <Clapperboard className="size-7 text-foreground/30" />
                        <strong>还没有符合条件的生成记录</strong>
                        <span>从一条想法生成多条剧本，再让每条剧本成为独立视频项目。</span>
                        <Button type="primary" onClick={() => navigate("/smart-film/batches/new")}>新建多剧本项目</Button>
                    </div>
                ) : (
                    <div className="smart-film-batch-list-grid">
                        {listQuery.data.batches.map((batch) => {
                            const projectCount = batch.scripts.filter((script) => Boolean(script.projectId)).length;
                            const readyCount = batch.scripts.filter((script) => script.status === "storyboard_ready").length;
                            const attentionCount = batch.scripts.filter((script) =>
                                script.status === "needs_attention"
                                || script.status === "failed"
                                || batch.productionRuns.some((run) => run.scriptId === script.id && (run.status === "needs_attention" || run.status === "failed")),
                            ).length;
                            return (
                                <article className="smart-film-batch-list-card" key={batch.id}>
                                    <div className="smart-film-batch-list-card-head">
                                        <div>
                                            <span className="text-[11px] text-foreground/40">生成记录</span>
                                            <h2>{batch.title}</h2>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-end gap-1">
                                            {attentionCount ? <Tag color="red">{attentionCount} 项待处理</Tag> : null}
                                            <Tag color={batch.status === "confirmed" ? "green" : batch.status === "partially_confirmed" ? "blue" : "default"}>{statusLabels[batch.status]}</Tag>
                                        </div>
                                    </div>
                                    <p>{batch.sourceText}</p>
                                    <div className="smart-film-batch-list-stats">
                                        <span><strong>{batch.scripts.length}</strong> 条剧本</span>
                                        <span><strong>{projectCount}</strong> 个项目</span>
                                        <span><strong>{readyCount}</strong> 个分镜完成</span>
                                        <span><strong>{attentionCount}</strong> 个待处理</span>
                                        <span><strong>{batch.control.queuedCount + batch.control.runningCount}</strong> 个后台任务</span>
                                    </div>
                                    <div className="smart-film-batch-list-card-foot">
                                        <span>{batch.paused ? "已暂停" : batch.control.currentProjectId ? "后台处理中" : `更新于 ${new Date(batch.updatedAt).toLocaleString()}`}</span>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button size="small" type="primary" onClick={() => navigate(`/smart-film/batches/${batch.id}`)}>继续制作</Button>
                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteBatch(batch)}>删除</Button>
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
