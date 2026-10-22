import { useEffect, useMemo, useState } from "react";
import { Button, Select } from "antd";
import { LoaderCircle, ScanLine } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { ownedResourceIdFromMediaRef } from "@/services/api/resources";
import {
    estimateUpscale,
    getUpscaleCapabilities,
    type UpscaleCapabilities,
    type UpscaleEstimate,
    type UpscaleModelCapability,
    type UpscaleQuality,
    type UpscaleResolution,
} from "@/services/api/media-upscale";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { useCanvasNodeActions } from "../canvas-node-action-context";
import { useUpstreamNodes } from "../canvas-node-graph-context";

type MediaUpscaleSettings = NonNullable<CanvasNodeMetadata["mediaUpscale"]>;
const defaultSettings: MediaUpscaleSettings = { model: "Topaz-Upscale-LowPirce", resolution: "1080p", quality: "Max" };

export function MediaUpscaleNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const actions = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id).filter((item) => item.type === CanvasNodeType.Image || item.type === CanvasNodeType.Video);
    const source = upstream[0];
    const sourceMediaType = source?.type === CanvasNodeType.Image ? "image" : "video";
    const resourceId = source ? ownedResourceIdFromMediaRef(source.metadata?.storageKey, source.metadata?.content) || ownedResourceIdFromMediaRef(undefined, source.metadata?.previewContent) : "";
    const savedSettings = node.metadata?.mediaUpscale || defaultSettings;
    const [capabilities, setCapabilities] = useState<UpscaleCapabilities>();
    const [estimate, setEstimate] = useState<UpscaleEstimate>();
    const [notice, setNotice] = useState("");
    const [estimating, setEstimating] = useState(false);
    const hasResult = Boolean(node.metadata?.content || node.metadata?.storageKey);
    const models = useMemo(() => (capabilities?.models || []).filter((model) => !source || model.mediaType === sourceMediaType), [capabilities, source, sourceMediaType]);
    const selectedModel = models.find((model) => model.id === savedSettings.model) || models[0];
    const settings: MediaUpscaleSettings = {
        ...savedSettings,
        model: selectedModel?.id || savedSettings.model,
        resolution: savedSettings.resolution || selectedModel?.defaultResolution,
        quality: savedSettings.quality || selectedModel?.defaultQuality,
    };

    useEffect(() => {
        let active = true;
        void getUpscaleCapabilities().then((value) => {
            if (active) setCapabilities(value);
        }).catch((error) => {
            if (active) setNotice(error instanceof Error ? error.message : "读取超分能力失败");
        });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!selectedModel || selectedModel.id === savedSettings.model) return;
        actions.updateMetadata?.(node.id, {
            mediaUpscale: {
                ...savedSettings,
                model: selectedModel.id,
                resolution: selectedModel.defaultResolution,
                quality: selectedModel.defaultQuality,
            },
        });
    }, [actions, node.id, savedSettings, selectedModel]);

    useEffect(() => {
        let active = true;
        setEstimate(undefined);
        setNotice("");
        if (hasResult || !resourceId || !selectedModel) return;
        const timer = window.setTimeout(() => {
            setEstimating(true);
            void estimateUpscale({
                model: selectedModel.id,
                resourceId,
                resolution: selectedModel.resolutions?.length ? settings.resolution : undefined,
                quality: selectedModel.qualities?.length ? settings.quality : undefined,
            }).then((value) => {
                if (active) setEstimate(value);
            }).catch((error) => {
                if (active) setNotice(error instanceof Error ? error.message : "费用预估失败");
            }).finally(() => {
                if (active) setEstimating(false);
            });
        }, 250);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [hasResult, resourceId, selectedModel, settings.quality, settings.resolution]);

    if (hasResult) {
        const resultIsImage = Boolean(node.metadata?.mimeType?.startsWith("image/"));
        return (
            <div className="flex h-full w-full flex-col overflow-hidden rounded-[var(--node-radius)] bg-black">
                {resultIsImage
                    ? <img className="min-h-0 flex-1 object-contain" src={node.metadata?.content} alt={node.title} />
                    : <video className="min-h-0 flex-1 object-contain" src={node.metadata?.content} controls playsInline preload="metadata" />}
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs" style={{ background: theme.node.panel, color: theme.node.text }}>
                    <span>{settings.model}</span>
                    <span className="opacity-60">{selectedModel?.outputResolution || "已完成"}</span>
                </div>
            </div>
        );
    }

    const patch = (value: Partial<MediaUpscaleSettings>) => actions.updateMetadata?.(node.id, { mediaUpscale: { ...settings, ...value } });
    const submit = () => {
        if (!source || !resourceId || !estimate || !selectedModel || !actions.startMediaUpscale) return;
        void actions.startMediaUpscale({
            nodeId: node.id,
            sourceNodeId: source.id,
            resourceId,
            model: selectedModel.id,
            resolution: selectedModel.resolutions?.length ? settings.resolution : undefined,
            quality: selectedModel.qualities?.length ? settings.quality : undefined,
        });
    };
    const modelOptions = models.map((model: UpscaleModelCapability) => ({ value: model.id, label: model.label }));

    return (
        <div className="flex h-full w-full flex-col gap-3 overflow-auto p-4 pt-10 text-xs" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex items-start gap-2">
                <ScanLine className="mt-0.5 size-4 shrink-0" />
                <div>
                    <div className="font-medium">AI 媒体超分</div>
                    <div className="mt-1 opacity-60">连接一个图片或视频节点；确认费用后创建云端任务。</div>
                </div>
            </div>
            {!source ? <div className="rounded-md border border-dashed p-3 opacity-60" style={{ borderColor: theme.node.stroke }}>请从左侧连接图片或视频</div> : (
                <div className="rounded-md px-3 py-2" style={{ background: theme.node.panel }}>
                    <div className="truncate font-medium">{source.title || sourceMediaType}</div>
                    <div className="mt-1 opacity-55">{resourceId ? `${sourceMediaType === "image" ? "图片" : "视频"}素材已就绪` : "该素材尚未进入素材库，请先上传为本地素材"}</div>
                </div>
            )}
            <label className="grid grid-cols-[72px_1fr] items-center gap-2">
                <span className="opacity-65">模型</span>
                <Select value={selectedModel?.id} options={modelOptions} onChange={(model) => patch({ model })} />
            </label>
            {selectedModel?.resolutions?.length ? (
                <label className="grid grid-cols-[72px_1fr] items-center gap-2">
                    <span className="opacity-65">分辨率</span>
                    <Select value={settings.resolution} options={selectedModel.resolutions.map((value) => ({ value, label: value }))} onChange={(resolution: UpscaleResolution) => patch({ resolution })} />
                </label>
            ) : null}
            {selectedModel?.qualities?.length ? (
                <label className="grid grid-cols-[72px_1fr] items-center gap-2">
                    <span className="opacity-65">质量</span>
                    <Select value={settings.quality} options={selectedModel.qualities.map((value) => ({ value, label: value }))} onChange={(quality: UpscaleQuality) => patch({ quality })} />
                </label>
            ) : null}
            {selectedModel?.inputConstraint ? <div className="rounded-md px-3 py-2 opacity-65" style={{ background: theme.node.panel }}>{selectedModel.inputConstraint}</div> : null}
            <div className="rounded-md px-3 py-2" style={{ background: theme.node.panel }}>
                {estimating ? <span className="inline-flex items-center gap-2 opacity-65"><LoaderCircle className="size-3.5 animate-spin" />正在预估费用</span>
                    : estimate ? <div className="flex items-end justify-between gap-3"><span className="opacity-60">{estimate.billing === "fixed_per_request" ? "按次计费" : `${estimate.durationSeconds.toFixed(2)} 秒 · ¥${estimate.unitPriceCnyPerSecond.toFixed(3)}/秒`}</span><strong className="text-base">¥{estimate.reservationCny.toFixed(2)}</strong></div>
                    : <span className="opacity-55">{notice || (source && !resourceId ? "仅素材库素材可提交超分" : "等待费用预估")}</span>}
            </div>
            <Button type="primary" block disabled={!estimate || estimating || !actions.startMediaUpscale} onClick={submit}>确认费用并开始超分</Button>
            <div className="opacity-45">固定价模型按次结算；Topaz 最终以实际输出时长结算。任务刷新后查询原任务，不重复提交。</div>
        </div>
    );
}
