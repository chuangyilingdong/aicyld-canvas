import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { App, Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { Camera, ChevronDown, ChevronRight, Images, Maximize2, Settings2, SlidersHorizontal, UserRound } from "lucide-react";

import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveNodeToolbarPlacement, resolveToolbarTools, type NodeToolbarGroup, type ToolContext, type ToolbarHandlers } from "@/lib/canvas/tool-registry";
import { subscribeCanvasGraphicsViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import type { ImageSplitParams } from "@/lib/canvas/canvas-image-data";
import { useCopyText } from "@/hooks/use-copy-text";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ViewportTransform } from "@/types/canvas";
import { buildImageToolbarTools } from "./canvas-image-toolbar-tools";
import { CanvasGridSplitPicker } from "./canvas-grid-split-picker";

type CanvasNodeToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onAnnotate: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onEmotion: (node: CanvasNodeData) => void;
    onPortraitTexture: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData, params: ImageSplitParams) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onDraftToFinal?: (node: CanvasNodeData, resolution: "720p" | "1080p") => void;
    onVideoEditOperation?: (node: CanvasNodeData, operation: "extend" | "inpaint") => void;
    onAngle: (node: CanvasNodeData) => void;
    onLighting: (node: CanvasNodeData) => void;
    onPanorama: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onExtractVideoFrames: (node: CanvasNodeData, preset?: "current" | "first" | "last") => void;
    onExtractAudioFromVideo: (node: CanvasNodeData) => void;
    onTrimVideoSegments: (node: CanvasNodeData) => void;
    onDepthCapture: (node: CanvasNodeData) => void;
    onSubtitleErase: (node: CanvasNodeData) => void;
    onSubtitles: (node: CanvasNodeData) => void;
    onTimeline: (node: CanvasNodeData) => void;
    extractingVideoFrames: boolean;
    extractingAudio: boolean;
    trimmingVideo: boolean;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onToggleLocked: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    workspaceMode?: CanvasWorkspaceMode;
};

type ToolbarTool = {
    section?: string;
    description?: string;
    id: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    group: NodeToolbarGroup;
    order: number;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
};

export function CanvasNodeToolbar({
    node,
    viewport,
    containerRef,
    onKeep,
    onLeave,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onAnnotate,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onMaskEdit,
    onEmotion,
    onPortraitTexture,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onDraftToFinal,
    onVideoEditOperation,
    onAngle,
    onLighting,
    onPanorama,
    onViewImage,
    onExtractVideoFrames,
    onExtractAudioFromVideo,
    onTrimVideoSegments,
    onDepthCapture,
    onSubtitleErase,
    onSubtitles,
    onTimeline,
    extractingVideoFrames,
    extractingAudio,
    trimmingVideo,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onToggleLocked,
    onDelete,
    workspaceMode = "professional",
}: CanvasNodeToolbarProps) {
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [containerWidth, setContainerWidth] = useState(1000);
    const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const { message } = App.useApp();
    const copyText = useCopyText();
    const themeName = useActiveTheme();
    const theme = canvasThemes[themeName];
    const simpleMode = workspaceMode === "simple";

    useEffect(() => {
        setOpenMenuId(null);
    }, [node?.id]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!node || !container) {
            setAnchor(null);
            return;
        }
        const element = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
        if (!element) {
            setAnchor(null);
            return;
        }
        let disposed = false;
        let queued = false;
        let containerRect = container.getBoundingClientRect();
        let toolbarWidth = toolbarRef.current?.offsetWidth || 0;
        let toolbarHeight = toolbarRef.current?.offsetHeight || 40;
        const update = () => {
            const nodeRect = element.getBoundingClientRect();
            const preferredLeft = nodeRect.left - containerRect.left + nodeRect.width / 2;
            const halfToolbar = toolbarWidth / 2;
            const canClamp = toolbarWidth > 0 && toolbarWidth <= containerRect.width - 20;
            let left = canClamp ? Math.min(Math.max(preferredLeft, halfToolbar + 10), containerRect.width - halfToolbar - 10) : preferredLeft;
            const above = nodeRect.top - containerRect.top - 30;
            let top = Math.max(toolbarHeight + 8, Math.min(above, containerRect.height - 8));
            // Node-specific panels live inside the canvas container, while the
            // docked Agent is a sibling overlay. Treat both as occluders so a
            // toolbar never becomes half-unusable beneath the Agent surface.
            const occludingPanels = [...Array.from(container.querySelectorAll<HTMLElement>("[data-canvas-node-panel]")), ...Array.from(document.querySelectorAll<HTMLElement>(".canvas-agent-panel"))];
            for (const panel of occludingPanels) {
                const panelRect = panel.getBoundingClientRect();
                const panelLeft = panelRect.left - containerRect.left;
                const panelRight = panelRect.right - containerRect.left;
                const panelTop = panelRect.top - containerRect.top;
                const panelBottom = panelRect.bottom - containerRect.top;
                if (left + halfToolbar <= panelLeft || left - halfToolbar >= panelRight || top <= panelTop || top - toolbarHeight >= panelBottom) continue;
                if (panelLeft >= toolbarWidth + 18) left = panelLeft - halfToolbar - 8;
                else if (containerRect.width - panelRight >= toolbarWidth + 18) left = panelRight + halfToolbar + 8;
                else if (panelTop >= toolbarHeight + 16) top = panelTop - 8;
                else if (containerRect.height - panelBottom >= toolbarHeight + 16) top = panelBottom + toolbarHeight + 8;
            }
            if (toolbarRef.current) {
                toolbarRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
                return;
            }
            setAnchor((current) => (current?.left === left && current.top === top ? current : { left, top }));
        };
        const scheduleUpdate = () => {
            if (queued || disposed) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                if (!disposed) update();
            });
        };
        const measure = () => {
            containerRect = container.getBoundingClientRect();
            toolbarWidth = toolbarRef.current?.offsetWidth || 0;
            toolbarHeight = toolbarRef.current?.offsetHeight || 40;
            setContainerWidth(containerRect.width);
            scheduleUpdate();
        };
        measure();
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(element);
        resizeObserver.observe(container);
        if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, scheduleUpdate);
        window.addEventListener("resize", measure);
        return () => {
            disposed = true;
            resizeObserver.disconnect();
            unsubscribeViewport();
            window.removeEventListener("resize", measure);
        };
    }, [anchor === null, containerRef, node, viewport.k, viewport.x, viewport.y]);

    if (!node || !anchor || node.type === CanvasNodeType.Director || node.metadata?.directorSceneId) return null;

    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const canDraftToFinal = isVideo && Boolean(node.metadata?.content) && node.metadata?.draft === "true" && Boolean(node.metadata?.taskProviderRequestId?.trim());
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning("暂无可复制的提示词");
            return;
        }
        copyText(prompt, "提示词已复制");
    };
    const imageTools = buildImageToolbarTools(node, {
        onUpload,
        onToggleFreeResize,
        onAnnotate,
        onMaskEdit,
        onEmotion,
        onPortraitTexture,
        onCrop,
        onUpscale,
        onSuperResolve,
        onAngle,
        onLighting,
        onPanorama,
        onViewImage,
        onCopyPrompt: copyImagePrompt,
        onReversePrompt,
    });

    // 构建 ToolContext——供注册表解析工具
    const nodeHoverHandlers = {
        onNodeInfo: onInfo,
        onNodeDelete: onDelete,
        onNodeRetry: onRetry,
        onNodeEditText: onEditText,
        onNodeDecreaseFont: onDecreaseFont,
        onNodeIncreaseFont: onIncreaseFont,
        onNodeToggleDialog: onToggleDialog,
        onNodeAnnotate: onAnnotate,
        onNodeGenerateImage: onGenerateImage,
        onNodeUpload: onUpload,
        onNodeDownload: onDownload,
        onNodeSaveAsset: onSaveAsset,
        onNodeMaskEdit: onMaskEdit,
        onNodeEmotion: onEmotion,
        onNodePortraitTexture: onPortraitTexture,
        onNodeCrop: onCrop,
        onNodeSplit: (target) => onSplit(target, { rows: 2, columns: 2 }),
        onNodeUpscale: onUpscale,
        onNodeSuperResolve: onSuperResolve,
        onNodeAngle: onAngle,
        onNodeViewImage: onViewImage,
        onNodeExtractVideoFrames: onExtractVideoFrames,
        onNodeExtractAudioFromVideo: onExtractAudioFromVideo,
        onNodeTrimVideoSegments: onTrimVideoSegments,
        onNodeCropVideo: onCrop,
        onNodeDepthCapture: onDepthCapture,
        onNodeSubtitleErase: onSubtitleErase,
        onNodeReversePrompt: onReversePrompt,
        onNodeToggleFreeResize: onToggleFreeResize,
        onNodeSubtitles: onSubtitles,
        onNodeTimeline: onTimeline,
        onNodeToggleLocked: onToggleLocked,
        onNodeCopyPrompt: copyImagePrompt,
    } as Partial<ToolbarHandlers> as ToolbarHandlers;

    const nodeHoverCtx: ToolContext = {
        selectedCount: 0,
        selectedNodeTypes: new Set(),
        selectedVideoCount: 0,
        canvasTool: "move",
        workspaceMode: workspaceMode || "professional",
        isProjectLinked: false,
        canUndo: false,
        canRedo: false,
        node,
        nodeMetadata: node.metadata,
        extractingVideoFrames,
        extractingAudio,
        trimmingVideo,
        mergingVideos: false,
        addPanelOpen: false,
        appearancePanelOpen: false,
        settingsPanelOpen: false,
        handlers: nodeHoverHandlers,
    };

    // 注册表统一提供动作合同、适用性和节点 Dock 层级。
    const registryTools = resolveToolbarTools("node-hover", nodeHoverCtx, null);
    const registryToolbarTools: ToolbarTool[] = registryTools.map((tool) => {
        const placement = resolveNodeToolbarPlacement(tool, nodeHoverCtx);
        return {
            id: tool.id,
            label: tool.displayLabel ? (typeof tool.displayLabel === "function" ? tool.displayLabel(nodeHoverCtx) : tool.displayLabel) : typeof tool.label === "function" ? tool.label(nodeHoverCtx) : tool.label,
            icon: typeof tool.icon === "function" ? tool.icon(nodeHoverCtx) : tool.icon,
            group: placement.group,
            order: placement.order,
            section: tool.nodeToolbar?.section,
            description: tool.nodeToolbar?.description,
            active: tool.active?.(nodeHoverCtx),
            danger: tool.danger,
            disabled: tool.disabled?.(nodeHoverCtx),
            onClick: () => tool.run(nodeHoverCtx),
        };
    });
    const allTools: ToolbarTool[] = hasImage && !simpleMode ? [...registryToolbarTools, ...imageTools] : registryToolbarTools;
    const compact = containerWidth < 640;
    const narrow = containerWidth < 420;
    const inGroup = (group: NodeToolbarGroup) => allTools.filter((tool) => tool.group === group).sort(compareToolbarTools);
    const primary = inGroup("primary");
    const primaryTools = narrow ? primary.slice(0, 1) : primary;
    // Image nodes use a deliberately small, stable action hierarchy. Keep the
    // underlying handlers/tool definitions intact, but only expose the actions
    // that belong to the four image workflows in the primary dock.
    const imagePrimaryTools = primary.filter((tool) => tool.id === "maskEdit");
    const portraitTools = compact ? [] : isImage ? inGroup("portrait").filter((tool) => tool.id === "emotion") : inGroup("portrait");
    const viewpointLightingTools = compact ? [] : isImage ? [...inGroup("viewpoint"), ...inGroup("lighting")].filter((tool) => tool.id === "angle" || tool.id === "lighting") : [...inGroup("viewpoint"), ...inGroup("lighting")];
    const panoramaTools = compact || isImage ? [] : inGroup("panorama");
    const processTools = compact
        ? [...inGroup("portrait"), ...inGroup("viewpoint"), ...inGroup("lighting"), ...inGroup("panorama"), ...inGroup("process"), ...(isImage ? allTools.filter((tool) => tool.id === "reversePrompt") : [])]
        : isImage
          ? [...inGroup("process").filter((tool) => tool.id === "crop" || tool.id === "split" || tool.id === "annotation"), ...allTools.filter((tool) => tool.id === "reversePrompt")]
          : inGroup("process");
    const workspaceTools = narrow ? [] : inGroup("workspace");
    const utilityTools = inGroup("utility");
    const imageSettingsTools = isImage ? allTools.filter((tool) => tool.id === "replace" || tool.id === "resize" || tool.id === "node-lock") : [];
    const processMenuLabel = compact ? "工具" : isVideo ? "提取素材" : isImage ? "图片工具" : isAudio ? "音频处理" : "文本调整";
    const videoProcessingTools = [
        ...registryToolbarTools.filter((tool) => tool.id === "trimRegenerate" || tool.id === "cropVideo" || tool.id === "subtitleErase" || tool.id === "depthCapture"),
        ...(narrow ? inGroup("workspace") : []),
    ];
    const videoAudioTool = registryToolbarTools.find((tool) => tool.id === "extractAudio");
    const videoSubtitleTool = registryToolbarTools.find((tool) => tool.id === "subtitles");
    const videoKeyframeTool = registryToolbarTools.find((tool) => tool.id === "extractFrames");
    const videoKeyframeTools: ToolbarTool[] = videoKeyframeTool
        ? [
              { ...videoKeyframeTool, id: "keyframe-current", label: "截取当前帧", onClick: () => onExtractVideoFrames(node, "current") },
              { ...videoKeyframeTool, id: "keyframe-first", label: "截取首帧", onClick: () => onExtractVideoFrames(node, "first") },
              { ...videoKeyframeTool, id: "keyframe-last", label: "截取尾帧", onClick: () => onExtractVideoFrames(node, "last") },
          ]
        : [];
    const videoGlobalTools: ToolbarTool[] = isVideo
        ? [
              {
                  id: "video-preview",
                  label: "预览",
                  icon: <Maximize2 className="size-3.5" />,
                  group: "utility",
                  order: 10,
                  disabled: !Boolean(node.metadata?.content),
                  onClick: () => onViewImage(node),
              },
              ...utilityTools,
          ]
        : [];
    const handleMenuOpenChange = (menuId: string, open: boolean) => {
        setOpenMenuId((current) => (open ? menuId : current === menuId ? null : current));
        if (open) onKeep(node.id);
        else if (!toolbarRef.current?.contains(document.activeElement)) onLeave();
    };
    const dockStyle = canvasDockStyle(theme, theme.node.text);

    return (
        <div
            ref={toolbarRef}
            className="canvas-node-toolbar absolute z-[var(--z-node-toolbar)] -translate-x-1/2 -translate-y-full"
            style={{ left: 0, top: 0, transform: `translate3d(${anchor.left}px, ${anchor.top}px, 0)`, width: "max-content", maxWidth: "calc(100% - 20px)", color: theme.node.text }}
            onMouseEnter={() => onKeep(node.id)}
            onMouseLeave={() => {
                if (!openMenuId) onLeave();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            data-canvas-no-zoom
            onKeyDown={(event) => event.stopPropagation()}
            onFocus={() => onKeep(node.id)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget) && !openMenuId) onLeave();
            }}
        >
            <div role="toolbar" aria-label="节点快捷工具" className="flex h-10 max-w-full items-center gap-0.5 overflow-visible rounded-[var(--dock-radius-tight)] px-1.5 backdrop-blur-2xl" style={{ ...dockStyle, border: 0 }}>
                {isVideo ? (
                    <>
                        {canDraftToFinal && onDraftToFinal ? (
                            <NodeDockMenuButton
                                menuId="video-draft-to-final"
                                label="转高清成片"
                                icon={<UpscaleToolbarIcon />}
                                tools={[
                                    { id: "draft-to-final-720p", label: "转 720P 成片", icon: null, group: "process", order: 1, onClick: () => onDraftToFinal(node, "720p") },
                                    { id: "draft-to-final-1080p", label: "转 1080P 成片", icon: null, group: "process", order: 2, onClick: () => onDraftToFinal(node, "1080p") },
                                ]}
                                openMenuId={openMenuId}
                                onOpenChange={handleMenuOpenChange}
                                placement="bottomLeft"
                            />
                        ) : null}
                        <NodeDockToolButton tool={{ id: "ai-upscale", label: "AI超分", icon: <UpscaleToolbarIcon />, group: "process", order: 1, onClick: () => onSuperResolve(node) }} showTooltip={false} />
                        {(node.metadata?.content || node.metadata?.storageKey) ? (
                            <NodeDockMenuButton
                                menuId="video-ai-remix"
                                label="视频二创"
                                icon={null}
                                tools={[
                                    ...(onVideoEditOperation ? [
                                        { id: "video-extend", label: "视频续写", icon: null, group: "process" as const, order: 1, onClick: () => onVideoEditOperation(node, "extend") },
                                        { id: "video-inpaint", label: "视频局部修改", icon: null, group: "process" as const, order: 2, onClick: () => onVideoEditOperation(node, "inpaint") },
                                    ] : []),
                                    { id: "video-reverse-prompt", label: "反推提示词", icon: null, group: "process" as const, order: 3, onClick: () => onReversePrompt(node) },
                                ]}
                                openMenuId={openMenuId}
                                onOpenChange={handleMenuOpenChange}
                                placement="bottomLeft"
                            />
                        ) : null}
                        {videoProcessingTools.length ? <NodeDockMenuButton menuId="video-processing" label="视频处理" icon={null} tools={videoProcessingTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} placement="bottomLeft" /> : null}
                        {videoAudioTool ? <NodeDockToolButton tool={videoAudioTool} showTooltip={false} /> : null}
                        {videoSubtitleTool ? <NodeDockToolButton tool={videoSubtitleTool} showTooltip={false} /> : null}
                        {videoKeyframeTools.length ? (
                            <NodeDockMenuButton menuId="video-keyframes" label="关键帧截取" icon={<Images className="size-3.5" />} tools={videoKeyframeTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} placement="bottomLeft" />
                        ) : null}
                        {workspaceTools.map((tool) => (
                            <NodeDockToolButton key={tool.id} tool={tool} />
                        ))}
                        {videoGlobalTools.length ? <span aria-hidden className="aceternity-dock-separator mx-1 h-5 w-px shrink-0" /> : null}
                        {videoGlobalTools.map((tool) => (
                            <NodeDockToolButton key={tool.id} tool={tool} iconOnly />
                        ))}
                    </>
                ) : (
                    <>
                        {isImage ? <NodeDockToolButton tool={{ id: "ai-upscale", label: "AI超分", icon: <UpscaleToolbarIcon />, group: "process", order: 1, onClick: () => onSuperResolve(node) }} showTooltip={false} /> : null}
                        {(isImage ? imagePrimaryTools : primaryTools).map((tool) => (
                            <NodeDockToolButton key={tool.id} tool={tool} showTooltip={tool.id !== "maskEdit"} />
                        ))}
                        {panoramaTools.map((tool) => (
                            <NodeDockToolButton key={tool.id} tool={tool} />
                        ))}
                        {portraitTools.length ? <NodeDockMenuButton menuId="portrait" label="人像调整" icon={<UserRound className="size-3.5" />} tools={portraitTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} /> : null}
                        {viewpointLightingTools.length ? (
                            <NodeDockMenuButton menuId="viewpoint-lighting" label={isImage ? "视角调整" : "视角"} icon={<Camera className="size-3.5" />} tools={viewpointLightingTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} />
                        ) : null}
                        {processTools.length ? (
                            <NodeDockMenuButton
                                menuId="process"
                                label={processMenuLabel}
                                icon={isImage ? <Images className="size-3.5" /> : <SlidersHorizontal className="size-3.5" />}
                                tools={processTools}
                                openMenuId={openMenuId}
                                onOpenChange={handleMenuOpenChange}
                                split={hasImage && !simpleMode ? { node, onSplit } : undefined}
                            />
                        ) : null}
                        {imageSettingsTools.length ? <NodeDockMenuButton menuId="image-settings" label="图片设置" icon={<Settings2 className="size-3.5" />} tools={imageSettingsTools} openMenuId={openMenuId} onOpenChange={handleMenuOpenChange} /> : null}
                        {workspaceTools.length ? <span aria-hidden className="aceternity-dock-separator mx-1 h-5 w-px shrink-0" /> : null}
                        {workspaceTools.map((tool) => (
                            <NodeDockToolButton key={tool.id} tool={tool} />
                        ))}
                        {utilityTools.length ? <span aria-hidden className="aceternity-dock-separator mx-1 h-5 w-px shrink-0" /> : null}
                        {utilityTools.map((tool) => (
                            <NodeDockToolButton key={tool.id} tool={tool} iconOnly />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
function UpscaleToolbarIcon() {
    return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
        <path d="M9 2h5v5M14 2 7 9" />
    </svg>;
}

function NodeDockToolButton({ tool, iconOnly = false, showTooltip = true }: { tool: ToolbarTool; iconOnly?: boolean; showTooltip?: boolean }) {
    const button = (
        <button
            type="button"
            className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5 outline-none ${tool.active ? "is-active" : ""} ${tool.danger ? "is-danger" : ""}`}
            aria-label={tool.label}
            aria-pressed={tool.active}
            disabled={tool.disabled}
            onClick={tool.onClick}
        >
            <span className="grid size-3.5 shrink-0 place-items-center">{tool.icon}</span>
            {!iconOnly ? <span className="inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{tool.label}</span> : null}
        </button>
    );
    return showTooltip ? <Tooltip title={tool.description ? `${tool.label}：${tool.description}` : tool.label}>{button}</Tooltip> : button;
}

function compareToolbarTools(left: ToolbarTool, right: ToolbarTool) {
    if (left.danger !== right.danger) return left.danger ? 1 : -1;
    return left.order - right.order;
}

function NodeDockMenuButton({
    menuId,
    label,
    icon,
    tools,
    openMenuId,
    onOpenChange,
    placement = "bottom",
    iconOnly = false,
    split,
}: {
    menuId: string;
    label: string;
    icon?: ReactNode;
    tools: ToolbarTool[];
    openMenuId: string | null;
    onOpenChange: (menuId: string, open: boolean) => void;
    placement?: "top" | "topRight" | "bottom" | "bottomLeft" | "bottomRight";
    iconOnly?: boolean;
    split?: { node: CanvasNodeData; onSplit: (node: CanvasNodeData, params: ImageSplitParams) => void };
}) {
    const open = openMenuId === menuId;
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [splitPanelOpen, setSplitPanelOpen] = useState(false);
    useEffect(() => {
        if (!open) {
            setSplitPanelOpen(false);
            return;
        }
        const frame = requestAnimationFrame(() => triggerRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const keepSplitMenuOpenRef = useRef(false);
    const splitEntry = split ? tools.find((tool) => tool.id === "split") : undefined;
    const renderItem = (tool: ToolbarTool): NonNullable<MenuProps["items"]>[number] => {
        const isSplit = Boolean(splitEntry && split && tool.id === "split");
        return {
            key: tool.id,
            // 菜单只保留功能名称；图标和辅助说明留在工具定义中，供其他上下文使用。
            icon: undefined,
            className: isSplit ? `canvas-grid-split-menu-item${splitPanelOpen ? " is-open" : ""}` : undefined,
            label: (
                <div
                    className={isSplit ? "canvas-grid-split-menu-label" : undefined}
                    onMouseDown={
                        isSplit
                            ? () => {
                                  keepSplitMenuOpenRef.current = true;
                              }
                            : undefined
                    }
                >
                    <div>
                        <span className="inline-flex items-center gap-2">{tool.label}</span>
                    </div>
                    {isSplit ? <ChevronRight className="canvas-grid-split-chevron" strokeWidth={2} /> : null}
                </div>
            ),
            disabled: tool.disabled,
            danger: tool.danger,
            onClick: (info) => {
                if (isSplit) {
                    info.domEvent.preventDefault();
                    info.domEvent.stopPropagation();
                    keepSplitMenuOpenRef.current = true;
                    setSplitPanelOpen((current) => !current);
                    return;
                }
                onOpenChange(menuId, false);
                tool.onClick();
            },
        };
    };
    const items: MenuProps["items"] = tools.map(renderItem);
    return (
        <Dropdown
            open={open}
            trigger={["click"]}
            placement={placement}
            autoAdjustOverflow={false}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && (keepSplitMenuOpenRef.current || document.querySelector(".canvas-node-toolbar-menu-split:hover, .canvas-grid-split-picker:hover"))) {
                    keepSplitMenuOpenRef.current = false;
                    return;
                }
                onOpenChange(menuId, nextOpen);
                if (!nextOpen) setSplitPanelOpen(false);
            }}
            menu={{ items }}
            autoFocus
            popupRender={(menu) => (
                <div
                    className={`canvas-node-toolbar-menu${splitEntry && split ? " canvas-node-toolbar-menu-split" : ""}`}
                    data-canvas-no-zoom
                    data-canvas-wheel-scroll
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                    onKeyDownCapture={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            triggerRef.current?.focus();
                            onOpenChange(menuId, false);
                        }
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <div className="canvas-node-toolbar-menu-stack">{menu}</div>
                    {splitPanelOpen && split ? (
                        <CanvasGridSplitPicker
                            onPick={(params) => {
                                setSplitPanelOpen(false);
                                onOpenChange(menuId, false);
                                split.onSplit(split.node, params);
                            }}
                        />
                    ) : null}
                </div>
            )}
        >
            <button
                ref={triggerRef}
                type="button"
                className={`aceternity-dock-command is-labeled pointer-events-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[var(--dock-item-radius)] px-2.5 outline-none ${open ? "is-active" : ""}`}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup="menu"
                title={label}
                onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && open) {
                        event.preventDefault();
                        document.querySelector<HTMLElement>(".ant-dropdown:not(.ant-dropdown-hidden) .canvas-node-toolbar-menu [role='menuitem']:not([aria-disabled='true'])")?.focus();
                    }
                    if (event.key === "Escape" && open) {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenChange(menuId, false);
                    }
                }}
            >
                {icon ? <span className="grid size-3.5 shrink-0 place-items-center">{icon}</span> : null}
                {!iconOnly ? (
                    <>
                        <span className="inline-flex h-4 items-center whitespace-nowrap text-[var(--fs-label)] font-medium leading-none">{label}</span>
                        <ChevronDown className="size-3 shrink-0 opacity-55" />
                    </>
                ) : null}
            </button>
        </Dropdown>
    );
}

