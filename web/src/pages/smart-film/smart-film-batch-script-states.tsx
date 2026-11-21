import { Button, Input } from "antd";
import { RefreshCcw, Sparkles } from "lucide-react";

import type { SmartFilmBatch } from "@/services/api/smart-film-batches";

export function SmartFilmBatchScriptEmptyState({
    batch,
    quoteText,
    busy,
    onGenerate,
    onRecover,
}: {
    batch: SmartFilmBatch;
    quoteText: string;
    busy: string;
    onGenerate: () => void;
    onRecover: () => void;
}) {
    return (
        <div className="smart-film-script-empty">
            <Sparkles className="size-7 text-foreground/30" />
            <strong>这次多剧本生成还没有剧本</strong>
            <span>上次生成成功的剧本可能尚未保存。先尝试恢复上次结果；找不到时再按同一组想法和参考图重新生成 {batch.config.scriptCount} 条独立剧本。</span>
            <small className="smart-film-script-generation-quote">{quoteText}</small>
            <div className="flex flex-wrap justify-center gap-2">
                <Button type="primary" loading={Boolean(busy)} onClick={onGenerate}>
                    重新生成剧本
                </Button>
                <Button icon={<RefreshCcw className="size-4" />} loading={Boolean(busy)} onClick={onRecover}>
                    恢复上次生成结果
                </Button>
            </div>
        </div>
    );
}

export function SmartFilmBatchScriptEditDialog({
    open,
    title,
    content,
    busy,
    onTitleChange,
    onContentChange,
    onClose,
    onSave,
}: {
    open: boolean;
    title: string;
    content: string;
    busy: string;
    onTitleChange: (value: string) => void;
    onContentChange: (value: string) => void;
    onClose: () => void;
    onSave: () => void;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-3xl rounded-2xl border border-border bg-background p-5 shadow-2xl">
                <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                        <strong className="text-base">修改独立剧本</strong>
                        <p className="mt-1 text-xs text-foreground/45">只修改当前这条剧本，不会影响其他独立视频。</p>
                    </div>
                    <Button onClick={onClose}>关闭</Button>
                </div>
                <Input value={title} maxLength={120} onChange={(event) => onTitleChange(event.target.value)} placeholder="剧本标题" />
                <Input.TextArea className="mt-3" value={content} onChange={(event) => onContentChange(event.target.value)} autoSize={{ minRows: 12, maxRows: 24 }} placeholder="剧本正文" />
                <div className="mt-4 flex justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" loading={Boolean(busy)} onClick={onSave}>
                        保存剧本
                    </Button>
                </div>
            </div>
        </div>
    );
}
