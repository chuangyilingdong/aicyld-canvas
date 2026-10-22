import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Select, Tag } from "antd";
import { ChevronRight, LoaderCircle, Play, WandSparkles } from "lucide-react";

import { CanvasImageMaskEditor } from "@/components/canvas/canvas-node-mask-edit-dialog";
import {
    MIDJOURNEY_ACTION_LABELS,
    midjourneyActionCapabilities,
    midjourneyActionFromNode,
    midjourneyIndexForNode,
    midjourneyUpstreamTaskId,
    midjourneyVideoIndexForNode,
    type MidjourneyAction,
    type MidjourneyActionSubmission,
} from "@/lib/canvas/canvas-midjourney";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type CanvasMidjourneyActionsDialogProps = {
    open: boolean;
    node: CanvasNodeData | null;
    nodes: CanvasNodeData[];
    config: AiConfig;
    onClose: () => void;
    onSubmit: (nodeId: string, payload: MidjourneyActionSubmission) => Promise<void>;
};

const INDEX_ACTIONS = new Set<MidjourneyAction>(["upscale", "variation", "high-variation", "low-variation", "inpaint", "remix-strong", "remix-subtle"]);
const PROMPT_ACTIONS = new Set<MidjourneyAction>(["edits", "remix-strong", "remix-subtle", "video"]);

export function CanvasMidjourneyActionsDialog({ open, node, nodes, config, onClose, onSubmit }: CanvasMidjourneyActionsDialogProps) {
    const capabilities = useMemo(() => node ? midjourneyActionCapabilities(node) : [], [node]);
    const [action, setAction] = useState<MidjourneyAction>("describe");
    const [prompt, setPrompt] = useState("");
    const [index, setIndex] = useState(1);
    const [customId, setCustomId] = useState("");
    const [direction, setDirection] = useState<"left" | "right" | "up" | "down">("right");
    const [zoomRatio, setZoomRatio] = useState(2);
    const [dimensions, setDimensions] = useState<"LANDSCAPE" | "PORTRAIT" | "SQUARE">("LANDSCAPE");
    const [version, setVersion] = useState("");
    const [referenceNodeIds, setReferenceNodeIds] = useState<string[]>([]);
    const [animateMode, setAnimateMode] = useState<"auto" | "manual">("manual");
    const [motion, setMotion] = useState<"low" | "high">("high");
    const [videoType, setVideoType] = useState("");
    const batchSize = 1 as const;
    const [videoIndex, setVideoIndex] = useState(0);
    const [endUrl, setEndUrl] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open || !node) return;
        const available = midjourneyActionCapabilities(node).filter((item) => item.enabled);
        const preferred = node.metadata?.midjourneyNextAction === "modal"
            ? available.find((item) => item.action === "modal")
            : available.find((item) => item.action === "upscale") || available.find((item) => item.action === "describe") || available[0];
        setAction(preferred?.action || "describe");
        setPrompt(node.metadata?.prompt || "");
        setIndex(midjourneyIndexForNode(node));
        setCustomId("");
        setDirection("right");
        setZoomRatio(2);
        setDimensions("LANDSCAPE");
        setVersion(node.metadata?.midjourneyVersion || "");
        setReferenceNodeIds(node.type === CanvasNodeType.Image ? [node.id] : []);
        setAnimateMode(midjourneyActionFromNode(node) === "imagine" && midjourneyUpstreamTaskId(node) ? "auto" : "manual");
        setMotion("high");
        setVideoType("");
        setEndUrl("");
        setSubmitting(false);
        setError("");
    }, [node?.id, open]);

    const imageOptions = useMemo(
        () => nodes
            .filter((candidate) => candidate.type === CanvasNodeType.Image && Boolean(candidate.metadata?.content))
            .map((candidate) => ({ value: candidate.id, label: candidate.title || candidate.id })),
        [nodes],
    );
    const current = capabilities.find((item) => item.action === action);
    const parentAction = node ? midjourneyActionFromNode(node) : "";
    const upstreamTaskId = node ? midjourneyUpstreamTaskId(node) : "";
    const canAutoVideo = parentAction === "imagine" && Boolean(upstreamTaskId);
    const modalStage = action === "modal";

    const submit = async (maskDataUrl?: string, promptOverride?: string) => {
        if (!node || !current?.enabled || submitting) return;
        const nextPrompt = (promptOverride ?? prompt).trim();
        if ((current.needsPrompt || action === "modal") && !nextPrompt) {
            setError("请填写提示词");
            return;
        }
        if (action === "blend" && (referenceNodeIds.length < 2 || referenceNodeIds.length > 4)) {
            setError("请选择 2–4 张图片");
            return;
        }
        if (action === "modal" && !maskDataUrl) {
            setError("请先在图片上涂抹蒙版");
            return;
        }
        if (action === "video" && animateMode === "auto" && !canAutoVideo) {
            setError("自动动画需要 Midjourney 上游 task_id");
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            await onSubmit(node.id, {
                action,
                prompt: nextPrompt || undefined,
                index: action === "video" ? (animateMode === "auto" ? videoIndex : undefined) : INDEX_ACTIONS.has(action) ? index : undefined,
                customId: customId.trim() || undefined,
                direction: action === "pan" ? direction : undefined,
                zoomRatio: action === "zoom" ? zoomRatio : undefined,
                dimensions: action === "blend" ? dimensions : undefined,
                version: normalizeVersionForSubmit(version),
                referenceNodeIds: action === "blend" ? referenceNodeIds : undefined,
                animateMode: action === "video" ? animateMode : undefined,
                motion: action === "video" ? motion : undefined,
                videoType: action === "video" && videoType.trim() ? videoType.trim() : undefined,
                batchSize: action === "video" ? batchSize : undefined,
                endUrl: action === "video" && endUrl.trim() ? endUrl.trim() : undefined,
                maskDataUrl,
            });
            onClose();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "提交失败，请稍后重试");
        } finally {
            setSubmitting(false);
        }
    };

    const maskSourceNode = node ? nodes.find((candidate) => candidate.id === node.metadata?.midjourneyMaskSourceNodeId) || node : null;
    const sourceWidth = maskSourceNode?.metadata?.naturalWidth || maskSourceNode?.width || 1024;
    const sourceHeight = maskSourceNode?.metadata?.naturalHeight || maskSourceNode?.height || 1024;
    const maskDisplay = fitMaskDisplay(sourceWidth, sourceHeight);
    const title = (
        <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-500"><WandSparkles className="size-4" /></span>
            <span>Midjourney 动作</span>
        </div>
    );

    return (
        <Modal open={open && Boolean(node)} title={title} footer={null} onCancel={onClose} width="min(980px, calc(100vw - 32px))" destroyOnHidden>
            {node ? (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 bg-black/[0.025] px-3 py-2 text-xs text-foreground/70 dark:border-white/10 dark:bg-white/[0.04]">
                        <Tag color="purple">父动作 {parentAction ? MIDJOURNEY_ACTION_LABELS[parentAction] : "未知"}</Tag>
                        <Tag color={upstreamTaskId ? "green" : "default"}>{upstreamTaskId ? "上游 task_id 已就绪" : "无上游 task_id"}</Tag>
                        <span className="min-w-0 truncate">源节点：{node.title || node.id}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        {capabilities.map((capability) => (
                            <button
                                key={capability.action}
                                type="button"
                                disabled={!capability.enabled || submitting}
                                title={capability.reason}
                                onClick={() => {
                                    setAction(capability.action);
                                    setError("");
                                }}
                                className={`min-h-16 rounded-xl border px-3 py-2 text-left transition ${
                                    action === capability.action
                                        ? "border-violet-500 bg-violet-500/10 text-foreground shadow-sm"
                                        : "border-black/10 bg-white text-foreground hover:border-violet-400 hover:bg-violet-500/[0.04] dark:border-white/10 dark:bg-white/[0.03]"
                                } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium">{MIDJOURNEY_ACTION_LABELS[capability.action]}</span>
                                    {action === capability.action ? <ChevronRight className="size-3.5 text-violet-500" /> : null}
                                </div>
                                {capability.reason ? <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-foreground/50">{capability.reason}</div> : null}
                            </button>
                        ))}
                    </div>

                    {!capabilities.some((item) => item.enabled) ? (
                        <Alert type="warning" showIcon message="当前节点没有可用的 Midjourney 动作" description={parentAction === "describe" ? "反推结果是文本节点，不能继续执行图片动作。" : "请先刷新原任务，或检查上游 task_id 是否已保存。"} />
                    ) : current?.enabled ? (
                        modalStage ? (
                            <div className="space-y-3">
                                <Alert type="info" showIcon message="第二阶段：补蒙版和提示词" description="涂抹区域会作为透明蒙版上传；保留区域为白色。没有蒙版不会提交付费请求。" />
                                <div className="overflow-visible rounded-2xl border border-black/10 bg-neutral-950 p-4 pt-20 dark:border-white/10" style={{ minHeight: maskDisplay.height + 150 }}>
                                    <div className="relative mx-auto overflow-hidden rounded-xl bg-black" style={{ width: maskDisplay.width, height: maskDisplay.height }}>
                                        {maskSourceNode?.metadata?.content ? <img src={maskSourceNode.metadata.content} alt="局部重绘源图" className="absolute inset-0 size-full object-contain" draggable={false} /> : null}
                                        <CanvasImageMaskEditor
                                            imageDimensions={{ width: sourceWidth, height: sourceHeight }}
                                            scale={1}
                                            config={config}
                                            onCancel={onClose}
                                            onConfirm={(payload) => submit(payload.maskDataUrl, payload.prompt)}
                                        />
                                    </div>
                                </div>
                                {error ? <div className="text-sm text-red-500">{error}</div> : null}
                            </div>
                        ) : (
                            <ActionForm
                                action={action}
                                prompt={prompt}
                                onPromptChange={setPrompt}
                                index={index}
                                onIndexChange={setIndex}
                                customId={customId}
                                onCustomIdChange={setCustomId}
                                direction={direction}
                                onDirectionChange={setDirection}
                                zoomRatio={zoomRatio}
                                onZoomRatioChange={setZoomRatio}
                                dimensions={dimensions}
                                onDimensionsChange={setDimensions}
                                version={version}
                                onVersionChange={setVersion}
                                referenceNodeIds={referenceNodeIds}
                                onReferenceNodeIdsChange={setReferenceNodeIds}
                                imageOptions={imageOptions}
                                animateMode={animateMode}
                                onAnimateModeChange={setAnimateMode}
                                motion={motion}
                                onMotionChange={setMotion}
                                videoType={videoType}
                                onVideoTypeChange={setVideoType}
                                batchSize={batchSize}
                                videoIndex={videoIndex}
                                onVideoIndexChange={setVideoIndex}
                                endUrl={endUrl}
                                onEndUrlChange={setEndUrl}
                                hasParent={canAutoVideo}
                                error={error}
                            />
                        )
                    ) : null}

                    {!modalStage && current?.enabled ? (
                        <div className="flex items-center justify-between gap-3 border-t border-black/8 pt-4 dark:border-white/10">
                            <div className="text-xs text-foreground/55">动作请求会创建新的结果节点，并保留父任务血缘。</div>
                            <div className="flex gap-2">
                                <Button onClick={onClose} disabled={submitting}>取消</Button>
                                <Button type="primary" icon={submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />} loading={submitting} onClick={() => void submit()}>
                                    提交动作
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </Modal>
    );
}

type ActionFormProps = {
    action: MidjourneyAction;
    prompt: string;
    onPromptChange: (value: string) => void;
    index: number;
    onIndexChange: (value: number) => void;
    customId: string;
    onCustomIdChange: (value: string) => void;
    direction: "left" | "right" | "up" | "down";
    onDirectionChange: (value: "left" | "right" | "up" | "down") => void;
    zoomRatio: number;
    onZoomRatioChange: (value: number) => void;
    dimensions: "LANDSCAPE" | "PORTRAIT" | "SQUARE";
    onDimensionsChange: (value: "LANDSCAPE" | "PORTRAIT" | "SQUARE") => void;
    version: string;
    onVersionChange: (value: string) => void;
    referenceNodeIds: string[];
    onReferenceNodeIdsChange: (value: string[]) => void;
    imageOptions: Array<{ value: string; label: string }>;
    animateMode: "auto" | "manual";
    onAnimateModeChange: (value: "auto" | "manual") => void;
    motion: "low" | "high";
    onMotionChange: (value: "low" | "high") => void;
    videoType: string;
    onVideoTypeChange: (value: string) => void;
    batchSize: 1 | 2 | 4;
    videoIndex: number;
    onVideoIndexChange: (value: number) => void;
    endUrl: string;
    onEndUrlChange: (value: string) => void;
    hasParent: boolean;
    error: string;
};

function ActionForm(props: ActionFormProps) {
    const { action } = props;
    const needsPrompt = PROMPT_ACTIONS.has(action);
    return (
        <div className="space-y-4">
            {needsPrompt ? (
                <Field label={action === "video" ? "动作提示词（可选）" : "修改提示词"}>
                    <Input.TextArea
                        value={props.prompt}
                        onChange={(event) => props.onPromptChange(event.target.value)}
                        autoSize={{ minRows: 3, maxRows: 6 }}
                        placeholder={action === "video" ? "描述镜头运动、主体动作或氛围…" : "描述希望如何修改这张图片…"}
                    />
                </Field>
            ) : null}

            {INDEX_ACTIONS.has(action) ? (
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label="宫格位置 index">
                        <InputNumber className="w-full" min={1} max={4} value={props.index} onChange={(value) => props.onIndexChange(Number(value) || 1)} />
                    </Field>
                    <Field label="custom_id（可选）">
                        <Input value={props.customId} onChange={(event) => props.onCustomIdChange(event.target.value)} placeholder="上游自定义标识" />
                    </Field>
                </div>
            ) : null}

            {action === "pan" ? (
                <Field label="平移方向">
                    <Select value={props.direction} onChange={props.onDirectionChange} options={[
                        { value: "left", label: "向左" },
                        { value: "right", label: "向右" },
                        { value: "up", label: "向上" },
                        { value: "down", label: "向下" },
                    ]} />
                </Field>
            ) : null}

            {action === "zoom" ? (
                <Field label="缩放倍率">
                    <Select value={props.zoomRatio} onChange={props.onZoomRatioChange} options={[
                        { value: 1.5, label: "1.5×" },
                        { value: 2, label: "2×" },
                        { value: 4, label: "4×" },
                    ]} />
                </Field>
            ) : null}

            {action === "blend" ? (
                <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                    <Field label="混合图片（2–4 张）">
                        <Select
                            mode="multiple"
                            value={props.referenceNodeIds}
                            onChange={props.onReferenceNodeIdsChange}
                            options={props.imageOptions}
                            maxTagCount="responsive"
                            placeholder="选择画布中的图片节点"
                        />
                    </Field>
                    <Field label="画面方向">
                        <Select value={props.dimensions} onChange={props.onDimensionsChange} options={[
                            { value: "LANDSCAPE", label: "横图" },
                            { value: "PORTRAIT", label: "竖图" },
                            { value: "SQUARE", label: "方图" },
                        ]} />
                    </Field>
                </div>
            ) : null}

            {action === "video" ? (
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label="动画模式">
                        <Select value={props.animateMode} onChange={props.onAnimateModeChange} options={[
                            { value: "auto", label: "自动（使用父任务）", disabled: !props.hasParent },
                            { value: "manual", label: "手动" },
                        ]} />
                    </Field>
                    <Field label="运动幅度">
                        <Select value={props.motion} onChange={props.onMotionChange} options={[
                            { value: "low", label: "低" },
                            { value: "high", label: "高" },
                        ]} />
                    </Field>
                    <Field label="首帧宫格位置">
                        <Select value={props.videoIndex} onChange={props.onVideoIndexChange} disabled={props.animateMode !== "auto"} options={[0, 1, 2, 3].map((value) => ({ value, label: `第 ${value + 1} 张` }))} />
                    </Field>
                    <Field label="video_type（可选）">
                        <Input value={props.videoType} onChange={(event) => props.onVideoTypeChange(event.target.value)} placeholder="vid_1.1_i2v_720" />
                    </Field>
                    <Field label="batch_size">
                        <Input value={String(props.batchSize)} disabled suffix={<span className="text-[11px]">固定 1</span>} />
                    </Field>
                    <div className="md:col-span-2">
                        <Field label="尾帧 end_url（可选）">
                            <Input value={props.endUrl} onChange={(event) => props.onEndUrlChange(event.target.value)} placeholder="https://…" />
                        </Field>
                    </div>
                </div>
            ) : null}

            <Field label="Midjourney 版本（可选）">
                <Select value={normalizeVersionForSubmit(props.version) || "default"} onChange={(value) => props.onVersionChange(value === "default" ? "" : value)} options={[
                    { value: "default", label: "沿用父任务 / 上游默认" },
                    { value: "7", label: "v7" },
                    { value: "6.1", label: "v6.1" },
                    { value: "6", label: "v6" },
                    { value: "5.2", label: "v5.2" },
                    { value: "5.1", label: "v5.1" },
                ]} />
            </Field>

            {props.error ? <Alert type="error" showIcon message={props.error} /> : null}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground/65">{label}</span>
            {children}
        </label>
    );
}

function normalizeVersionForSubmit(value: string) {
    return value.trim().replace(/^v/i, "");
}
function fitMaskDisplay(width: number, height: number) {
    const ratio = width > 0 && height > 0 ? width / height : 1;
    let displayWidth = Math.min(760, width || 760);
    let displayHeight = displayWidth / ratio;
    if (displayHeight > 520) {
        displayHeight = 520;
        displayWidth = displayHeight * ratio;
    }
    return { width: Math.max(240, Math.round(displayWidth)), height: Math.max(180, Math.round(displayHeight)) };
}
