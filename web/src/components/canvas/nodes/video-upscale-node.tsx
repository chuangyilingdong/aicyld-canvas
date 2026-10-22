import { useEffect, useState } from "react";
import { Button, Select } from "antd";
import { LoaderCircle, ScanLine } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { ownedResourceIdFromMediaRef } from "@/services/api/resources";
import {
    estimateVideoUpscale,
    getVideoUpscaleCapabilities,
    type VideoUpscaleCapabilities,
    type VideoUpscaleEstimate,
    type VideoUpscaleQuality,
    type VideoUpscaleResolution,
} from "@/services/api/media-upscale";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { useCanvasNodeActions } from "../canvas-node-action-context";
import { useUpstreamNodes } from "../canvas-node-graph-context";

type VideoUpscaleSettings = NonNullable<CanvasNodeMetadata["videoUpscale"]>;
const defaultSettings: VideoUpscaleSettings = { resolution: "1080p", quality: "Max" };

export function VideoUpscaleNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const actions = useCanvasNodeActions();
    const upstream = useUpstreamNodes(node.id).filter((item) => item.type === CanvasNodeType.Video);
    const source = upstream[0];
    const resourceId = source ? ownedResourceIdFromMediaRef(source.metadata?.storageKey, source.metadata?.content) || ownedResourceIdFromMediaRef(undefined, source.metadata?.previewContent) : "";
    const settings = node.metadata?.videoUpscale || defaultSettings;
    const [capabilities, setCapabilities] = useState<VideoUpscaleCapabilities>();
    const [estimate, setEstimate] = useState<VideoUpscaleEstimate>();
    const [notice, setNotice] = useState("");
    const [estimating, setEstimating] = useState(false);
    const hasResult = Boolean(node.metadata?.content || node.metadata?.storageKey);

    useEffect(() => {
        let active = true;
        void getVideoUpscaleCapabilities().then((value) => {
            if (active) setCapabilities(value);
        }).catch((error) => {
            if (active) setNotice(error instanceof Error ? error.message : "读取视频超分能力失败");
        });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;
        setEstimate(undefined);
        setNotice("");
        if (hasResult || !resourceId || !capabilities) return;
        const timer = window.setTimeout(() => {
            setEstimating(true);
            void estimateVideoUpscale({ resourceId, resolution: settings.resolution, quality: settings.quality }).then((value) => {
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
    }, [capabilities, hasResult, resourceId, settings.quality, settings.resolution]);

    if (hasResult) {
        return (
            <div className="flex h-full w-full flex-col overflow-hidden rounded-[var(--node-radius)] bg-black">
                <video className="min-h-0 flex-1 object-contain" src={node.metadata?.content} controls playsInline preload="metadata" />
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs" style={{ background: theme.node.panel, color: theme.node.text }}>
                    <span>{settings.resolution} · {settings.quality}</span>
                    <span className="opacity-60">Topaz 已完成</span>
                </div>
            </div>
        );
    }

    const patch = (value: Partial<VideoUpscaleSettings>) => actions.updateMetadata?.(node.id, { videoUpscale: { ...settings, ...value } });
    const submit = () => {
        if (!source || !resourceId || !estimate || !actions.startVideoUpscale) return;
        void actions.startVideoUpscale({
            nodeId: node.id,
            sourceNodeId: source.id,
            resourceId,
            resolution: settings.resolution,
            quality: settings.quality,
        });
    };

    return (
        <div className="flex h-full w-full flex-col gap-3 overflow-auto p-4 pt-10 text-xs" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex items-start gap-2">
                <ScanLine className="mt-0.5 size-4 shrink-0" />
                <div>
                    <div className="font-medium">Topaz 视频超分</div>
                    <div className="mt-1 opacity-60">连接一个视频节点；保留画面比例，按实际输出时长计费。</div>
                </div>
            </div>
            {!source ? <div className="rounded-md border border-dashed p-3 opacity-60" style={{ borderColor: theme.node.stroke }}>请从左侧连接源视频</div> : (
                <div className="rounded-md px-3 py-2" style={{ background: theme.node.panel }}>
                    <div className="truncate font-medium">{source.title || "源视频"}</div>
                    <div className="mt-1 opacity-55">{resourceId ? "素材已就绪" : "该视频尚未进入素材库，请先上传为本地素材"}</div>
                </div>
            )}
            <label className="grid grid-cols-[72px_1fr] items-center gap-2">
                <span className="opacity-65">分辨率</span>
                <Select value={settings.resolution} options={(capabilities?.resolutions || ["720p", "1080p", "2K", "4K"]).map((value) => ({ value, label: value }))} onChange={(resolution: VideoUpscaleResolution) => patch({ resolution })} />
            </label>
            <label className="grid grid-cols-[72px_1fr] items-center gap-2">
                <span className="opacity-65">质量</span>
                <Select value={settings.quality} options={(capabilities?.qualities || ["Low", "Medium", "High", "Max", "Ultra"]).map((value) => ({ value, label: value }))} onChange={(quality: VideoUpscaleQuality) => patch({ quality })} />
            </label>
            <div className="rounded-md px-3 py-2" style={{ background: theme.node.panel }}>
                {estimating ? <span className="inline-flex items-center gap-2 opacity-65"><LoaderCircle className="size-3.5 animate-spin" />正在预估费用</span>
                    : estimate ? <div className="flex items-end justify-between gap-3"><span className="opacity-60">{estimate.durationSeconds.toFixed(2)} 秒 · ¥{estimate.unitPriceCnyPerSecond.toFixed(3)}/秒</span><strong className="text-base">¥{estimate.reservationCny.toFixed(2)}</strong></div>
                    : <span className="opacity-55">{notice || (source && !resourceId ? "仅素材库视频可提交超分" : "等待费用预估")}</span>}
            </div>
            <Button type="primary" block disabled={!estimate || estimating || !actions.startVideoUpscale} onClick={submit}>确认费用并开始超分</Button>
            <div className="opacity-45">最终费用以实际输出时长结算；提交后将复用任务恢复链，不在刷新时重复提交。</div>
        </div>
    );
}
