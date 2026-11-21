import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { Copy, Download, Info, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { createPortal } from "react-dom";

import { VideoPlayer } from "@/components/video-player";
import { useCopyText } from "@/hooks/use-copy-text";
import { buildCanvasMediaDownloadFileName, mediaFileExtension } from "@/lib/canvas/canvas-media-download";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { downloadOwnedOrBrowserMedia } from "@/services/desktop-media-save";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type CanvasMediaViewerFact = { label: string; value: string };

export function canvasNodeMediaViewerFacts(node: CanvasNodeData): CanvasMediaViewerFact[] {
    const metadata = node.metadata;
    if (!metadata) return [];
    const facts: CanvasMediaViewerFact[] = [];
    const add = (label: string, value: string | number | undefined) => {
        if (value === undefined || value === "") return;
        facts.push({ label, value: String(value) });
    };
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) add("类型", node.type === CanvasNodeType.Image ? "图片" : "视频");
    if (metadata.naturalWidth && metadata.naturalHeight) add("像素尺寸", `${metadata.naturalWidth} × ${metadata.naturalHeight} px`);
    add("比例", metadata.size);
    add("质量 / 分辨率", metadata.vquality || metadata.quality);
    if (metadata.durationMs) add("视频时长", formatDuration(metadata.durationMs));
    if (metadata.bytes) add("文件大小", formatBytes(metadata.bytes));
    add("格式", metadata.mimeType);
    return facts;
}

export function CanvasNodeMediaViewer({
    node,
    source,
    onClose,
    onOpenNodeInfo,
}: {
    node: CanvasNodeData;
    source: string;
    onClose: () => void;
    onOpenNodeInfo?: (nodeId: string) => void;
}) {
    const { message } = App.useApp();
    const theme = canvasThemes[useActiveTheme()];
    const config = useEffectiveConfig();
    const copyText = useCopyText();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const isVideo = node.type === CanvasNodeType.Video;
    const prompt = node.metadata?.prompt?.trim() || "";
    const facts = canvasNodeMediaViewerFacts(node);
    const model = node.metadata?.model ? modelDisplayName(config, node.metadata.model) : "";

    useEffect(() => {
        const previous = document.activeElement;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        };
        dialogRef.current?.focus({ preventScroll: true });
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
        };
    }, [onClose]);

    const download = async () => {
        setDownloading(true);
        try {
            const storageKey = node.metadata?.storageKey || "";
            const resourceId = storageKey.startsWith("resource:") ? storageKey.slice("resource:".length) : "";
            const extension = mediaFileExtension(node.metadata?.mimeType, source) || (isVideo ? "mp4" : "png");
            const fileName = buildCanvasMediaDownloadFileName(node.title || "画布", {
                ...node,
                metadata: { ...node.metadata, mimeType: node.metadata?.mimeType || (isVideo ? "video/mp4" : "image/png") },
            }).replace(/\.[^.]+$/, `.${extension}`);
            const result = await downloadOwnedOrBrowserMedia({ fileName, resourceId: resourceId || undefined, browserUrl: source });
            if (result === "saved") message.success("已开始下载");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败，请重试");
        } finally {
            setDownloading(false);
        }
    };

    const overlayRoot = typeof document !== "undefined" ? document.body : null;
    if (!overlayRoot || !source) return null;

    return createPortal(
        <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`${isVideo ? "视频" : "图片"}预览：${node.title || "未命名节点"}`}
            data-testid="canvas-node-media-viewer"
            className="fixed inset-0 z-[var(--z-toast)] flex flex-col outline-none"
            style={{ background: theme.canvas.background, color: theme.node.text }}
        >
            <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{node.title || (isVideo ? "视频" : "图片")}</div>
                    <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>
                        {[isVideo ? "视频" : "图片", model].filter(Boolean).join(" · ")}
                    </div>
                </div>
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs"
                    style={{ background: theme.toolbar.itemHover }}
                    disabled={downloading}
                    onClick={() => void download()}
                >
                    <Download className="size-3.5" />
                    下载
                </button>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md border"
                    style={{ borderColor: theme.toolbar.border, background: sidebarOpen ? theme.toolbar.activeBg : theme.toolbar.itemHover }}
                    aria-label={sidebarOpen ? "收起生成信息栏" : "展开生成信息栏"}
                    aria-pressed={sidebarOpen}
                    onClick={() => setSidebarOpen((value) => !value)}
                >
                    {sidebarOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                </button>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md"
                    style={{ background: theme.toolbar.itemHover }}
                    aria-label={`关闭${isVideo ? "视频" : "图片"}预览`}
                    onClick={onClose}
                >
                    <X className="size-4" />
                </button>
            </header>
            <div className="flex min-h-0 flex-1">
                <main className="grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden p-4">
                    {isVideo ? (
                        <VideoPlayer
                            src={source}
                            mimeType={node.metadata?.mimeType}
                            title={node.title || "视频预览"}
                            hasAudio={typeof node.metadata?.hasAudio === "boolean" ? node.metadata.hasAudio : undefined}
                            className="max-h-full max-w-full bg-black"
                        />
                    ) : (
                        <img
                            src={source}
                            alt={node.title || "图片预览"}
                            className="max-h-full max-w-full object-contain"
                            draggable={false}
                        />
                    )}
                </main>
                {sidebarOpen ? (
                    <aside
                        aria-label="生成信息面板"
                        className="flex w-[328px] shrink-0 flex-col border-l"
                        style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}
                    >
                        <div className="flex h-12 shrink-0 items-center border-b px-4 text-sm font-medium" style={{ borderColor: theme.toolbar.border }}>
                            生成信息
                        </div>
                        <div className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4" data-canvas-wheel-scroll>
                            <section className="space-y-2">
                                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                                    <span>完整提示词</span>
                                    {prompt ? (
                                        <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-1" onClick={() => copyText(prompt, "提示词已复制")}>
                                            <Copy className="size-3.5" />
                                            复制
                                        </button>
                                    ) : null}
                                </div>
                                <div className="max-h-56 select-text overflow-y-auto whitespace-pre-wrap break-words rounded-md border p-3 text-xs leading-5" style={{ borderColor: theme.toolbar.border, background: theme.timeline.trackFill, color: prompt ? theme.node.text : theme.node.muted }}>
                                    {prompt || "该媒体暂无提示词记录"}
                                </div>
                            </section>
                            <section className="space-y-2">
                                <div className="text-xs" style={{ color: theme.node.muted }}>
                                    规格明细
                                </div>
                                <dl className="divide-y" style={{ borderColor: theme.toolbar.border }}>
                                    {facts.map((fact) => (
                                        <div key={fact.label} className="flex items-start justify-between gap-3 py-2 text-xs" style={{ borderColor: theme.toolbar.border }}>
                                            <dt style={{ color: theme.node.muted }}>{fact.label}</dt>
                                            <dd className="min-w-0 break-words text-right">{fact.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                            {onOpenNodeInfo ? (
                                <button
                                    type="button"
                                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border text-xs"
                                    style={{ borderColor: theme.toolbar.border, background: theme.timeline.trackFill }}
                                    onClick={() => {
                                        onClose();
                                        onOpenNodeInfo(node.id);
                                    }}
                                >
                                    <Info className="size-3.5" />
                                    节点信息
                                </button>
                            ) : null}
                        </div>
                    </aside>
                ) : null}
            </div>
        </div>,
        overlayRoot,
    );
}
