import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Modal, Tag } from "antd";
import { Plus } from "lucide-react";

import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { ASSET_CATEGORY_OPTIONS } from "@/lib/asset-category";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasNodeAssetCategory } from "@/lib/canvas/canvas-node-asset";
import { explainGenerationError } from "@/lib/generation-error";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { canvasNodeDiagnosticContext } from "@/services/diagnostics/canvas-media-diagnostics";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

type CanvasAssetCategory = NonNullable<NonNullable<CanvasNodeData["metadata"]>["assetCategory"]>;
const assetCategoryOptions: Array<{ value: CanvasAssetCategory; label: string }> = ASSET_CATEGORY_OPTIONS;

export function CanvasNodeInfoModal({
    node,
    open,
    onClose,
    onMetadataChange,
    readOnly = false,
    onUnauthorized,
}: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onMetadataChange?: (nodeId: string, metadata: Partial<CanvasNodeMetadata>) => void;
    readOnly?: boolean;
    onUnauthorized?: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const [assetTags, setAssetTags] = useState<string[]>([]);
    const [assetTagInput, setAssetTagInput] = useState("");
    const [assetCategory, setAssetCategory] = useState<CanvasAssetCategory>("other");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.batchChildIds?.length || 0 : 0;
    const nodeTypeLabel =
        node?.type === CanvasNodeType.Text
            ? "文本"
            : node?.type === CanvasNodeType.Script
              ? "分镜脚本"
              : node?.type === CanvasNodeType.Skill
                ? "技能"
                : node?.type === CanvasNodeType.Image
                  ? "图片"
                  : node?.type === CanvasNodeType.Video
                    ? "视频"
                    : node?.type === CanvasNodeType.Audio
                      ? "音频"
                      : node?.type === CanvasNodeType.Drawing
                        ? "绘图"
                        : node?.type === CanvasNodeType.Frame
                          ? "背板"
                          : "生成配置";
    useEffect(() => {
        setAssetTags(node?.metadata?.assetTags || []);
        setAssetTagInput("");
        setAssetCategory(node ? canvasNodeAssetCategory(node) : "other");
    }, [node?.id, node?.metadata?.assetCategory, node?.metadata?.assetTags]);

    const saveAssetCategory = (category: CanvasAssetCategory) => {
        if (!node || node.type !== CanvasNodeType.Image) return;
        setAssetCategory(category);
        onMetadataChange?.(node.id, { assetCategory: category });
    };

    const saveAssetTags = (nextTags: string[]) => {
        if (!node || node.type !== CanvasNodeType.Image) return;
        const tags = Array.from(new Set(nextTags.map((item) => item.trim()).filter(Boolean)));
        setAssetTags(tags);
        onMetadataChange?.(node.id, { assetTags: tags });
    };

    const addAssetTag = () => {
        const tags = assetTagInput
            .split(/\n|,|，/)
            .map((item) => item.trim())
            .filter(Boolean);
        if (!tags.length) return;
        saveAssetTags([...assetTags, ...tags]);
        setAssetTagInput("");
    };

    const removeAssetTag = (tag: string) => {
        saveAssetTags(assetTags.filter((item) => item !== tag));
    };

    const title = (
        <div className="canvas-node-inspector-title">
            <div className="min-w-0">
                <div className="text-[var(--fs-heading-lg)] font-semibold">节点信息</div>
                {node ? <div className="canvas-node-inspector-id">{node.id}</div> : null}
            </div>
        </div>
    );

    return (
        <Modal className="workspace-modal canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose} width="min(920px, calc(100vw - 32px))" styles={{ body: { paddingTop: 4 } }}>
            {node ? (
                <div className="canvas-node-inspector" style={{ color: theme.node.text }}>
                    <div className="thin-scrollbar canvas-node-inspector-scroll">
                        <section className="canvas-node-inspector-section">
                            <div className="canvas-node-inspector-section-heading">
                                <span>基础信息</span>
                                <em>{node.metadata?.status || "idle"}</em>
                            </div>
                            <div className="canvas-node-inspector-facts">
                                <InfoRow label="类型" value={nodeTypeLabel} />
                                <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                                <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                                {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                                {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            </div>
                        </section>

                        {node.type === CanvasNodeType.Image ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>项目资产分类</span>
                                </div>
                                <div className="canvas-node-inspector-options">
                                    {assetCategoryOptions.map((option) => {
                                        const active = assetCategory === option.value;
                                        return (
                                            <button key={option.value} type="button" disabled={readOnly} aria-pressed={active} onClick={() => saveAssetCategory(option.value)} className={active ? "is-active" : ""}>
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="canvas-node-inspector-help">生成后会按此分类进入项目资产；角色、场景和画风工作流会自动预填。</p>
                            </section>
                        ) : null}

                        {node.metadata?.prompt ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>提示词</span>
                                </div>
                                <div className="canvas-node-inspector-copy canvas-node-inspector-prompt">{node.metadata.prompt}</div>
                            </section>
                        ) : null}

                        {canvasNodeGenerationInfoRows(node).length ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>生成信息</span>
                                </div>
                                <div className="canvas-node-inspector-facts">
                                    {canvasNodeGenerationInfoRows(node).map((item) => (
                                        <InfoRow key={item.label} label={item.label} value={item.value} />
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {node.type === CanvasNodeType.Skill && node.metadata?.skillSnapshot ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <span>技能模板</span>
                                </div>
                                <div className="canvas-node-inspector-copy">{node.metadata.skillSnapshot.template}</div>
                                {node.metadata.skillSnapshot.outputContract ? (
                                    <>
                                        <div className="canvas-node-inspector-subheading">输出约束</div>
                                        <div className="canvas-node-inspector-copy">{node.metadata.skillSnapshot.outputContract}</div>
                                    </>
                                ) : null}
                            </section>
                        ) : null}

                        {node.type === CanvasNodeType.Image ? (
                            <section className="canvas-node-inspector-section">
                                <div className="canvas-node-inspector-section-heading">
                                    <div>
                                        <span>资产标签</span>
                                        <p>一条标签描述一个角色、环境、道具或镜头用途。</p>
                                    </div>
                                    <em>{assetTags.length} 条</em>
                                </div>
                                {readOnly ? (
                                    <div className="canvas-node-inspector-notice">分享画布为只读，标签无法编辑。</div>
                                ) : (
                                    <div className="canvas-node-inspector-tag-editor">
                                        <Input value={assetTagInput} placeholder="例如：角色: 张三" onChange={(event) => setAssetTagInput(event.target.value)} onPressEnter={addAssetTag} />
                                        <Button type="primary" icon={<Plus className="size-4" />} disabled={!assetTagInput.trim()} onClick={addAssetTag}>
                                            加入
                                        </Button>
                                    </div>
                                )}
                                <div className="canvas-node-inspector-tags">
                                    {assetTags.length ? (
                                        assetTags.map((tag) => (
                                            <Tag key={tag} closable={!readOnly} onClose={() => (readOnly ? onUnauthorized?.() : removeAssetTag(tag))} className="!m-0 !rounded-lg !px-2 !py-1 !text-sm">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <span className="canvas-node-inspector-empty-label">{readOnly ? "暂无标签" : "还没有标签，输入后点击“加入”或按 Enter。"}</span>
                                    )}
                                </div>
                            </section>
                        ) : null}

                        {node.metadata?.errorDetails ? (
                            <section className="canvas-node-inspector-error">
                                <GenerationFailureNotice
                                    explanation={explainGenerationError(
                                        { code: node.metadata.generationErrorCode || node.metadata.taskErrorCode, message: node.metadata.errorDetails },
                                        { taskId: node.metadata.taskId, model: node.metadata.model, createdAt: node.metadata.taskCreatedAt, stage: node.metadata.taskStage },
                                    )}
                                    context={{ ...canvasNodeDiagnosticContext(node), model: node.metadata.model, createdAt: node.metadata.taskCreatedAt, stage: node.metadata.taskStage, providerRequestId: node.metadata.taskProviderRequestId, failureDiagnostics: node.metadata.taskFailureDiagnostics, errorSummary: node.metadata.generationErrorSummary, providerCode: node.metadata.generationProviderCode, completedAt: node.metadata.taskCompletedAt, updatedAt: node.metadata.taskUpdatedAt }}
                                />
                            </section>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="canvas-node-inspector-fact">
            <div>{label}</div>
            <strong>{value}</strong>
        </div>
    );
}

export function canvasNodeGenerationInfoRows(node: CanvasNodeData) {
    const metadata = node.metadata;
    if (!metadata) return [] as Array<{ label: string; value: string }>;
    const rows: Array<{ label: string; value: string }> = [];
    const add = (label: string, value: unknown) => {
        if (value === undefined || value === null || value === "") return;
        rows.push({ label, value: String(value) });
    };
    const addTime = (label: string, value?: string) => {
        if (!value) return;
        const timestamp = Date.parse(value);
        add(label, Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value);
    };
    const addDuration = (value?: number) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        const totalSeconds = Math.max(0, Math.round(value / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        add("耗时", minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒`);
    };

    add("模型", metadata.model);
    add("生成尺寸", metadata.size);
    add("分辨率", metadata.vquality || metadata.quality);
    add("秒数", metadata.seconds ? `${metadata.seconds} 秒` : undefined);
    add("生成声音", metadata.generateAudio === undefined ? undefined : metadata.generateAudio === "true" ? "开启" : "关闭");
    add("水印", metadata.watermark === undefined ? undefined : metadata.watermark === "true" ? "开启" : "关闭");
    if (metadata.references?.length) {
        const referenceNames = metadata.references
            .slice(0, 3)
            .map((reference) => reference.split("/").pop() || reference)
            .join("、");
        add("引用素材", `${metadata.references.length} 个${referenceNames ? `（${referenceNames}${metadata.references.length > 3 ? "…" : ""}）` : ""}`);
    }
    addTime("创建时间", metadata.taskCreatedAt);
    addTime("开始时间", metadata.taskStartedAt);
    addTime("完成时间", metadata.taskCompletedAt);
    addDuration(metadata.taskDurationMs);
    return rows;
}
