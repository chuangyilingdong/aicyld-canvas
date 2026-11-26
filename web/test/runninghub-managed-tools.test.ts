import { describe, expect, test } from "bun:test";
import { mergeRunningHubUpscaleCapabilities, selectedUpscaleModelOption } from "@/services/api/media-upscale";
import { createDefaultUpscaleSettings, upscaleParamsForNode } from "@/lib/canvas/canvas-upscale";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("RunningHub canvas media tools", () => {
    test("registers only the supported RunningHub upscale endpoints", () => {
        const capabilities = mergeRunningHubUpscaleCapabilities({
            modes: [],
            cloudProcessing: true,
            maxVideoDurationMs: 300_000,
            runningHubModels: [{
                id: "topaz-standard",
                label: "Topaz Standard V2",
                endpoint: "topazlabs/image-upscale-standard-v2",
                capability: "image",
                channelId: "rh-ai",
                channelModelKey: "topaz-standard",
                protocol: "runninghub-standard-image",
                billingSummary: "按输出像素计费",
            }],
            runningHubVideoModels: [
                {
                    id: "rh-upscale",
                    label: "RH Upscale",
                    endpoint: "rhart-video/rh-upscale/enhance-frame",
                    capability: "video",
                    channelId: "rh-cn",
                    channelModelKey: "rh-upscale",
                    protocol: "runninghub-standard-video",
                    billingSummary: "按视频时长和增强档位计费",
                },
                {
                    id: "subtitle",
                    label: "字幕擦除",
                    endpoint: "volc-subtitle-erase/video",
                    capability: "video",
                    channelId: "rh-cn",
                    channelModelKey: "subtitle",
                    protocol: "runninghub-standard-video",
                    billingSummary: "按视频时长计费",
                },
            ],
        });
        expect(capabilities.modes).toHaveLength(2);
        const imageOption = selectedUpscaleModelOption(capabilities, "image", "precision", "rh-ai::topaz-standard");
        const videoOption = selectedUpscaleModelOption(capabilities, "video", "precision", "rh-cn::rh-upscale");
        expect(imageOption).toMatchObject({ provider: "runninghub", channelId: "rh-ai", channelModelKey: "topaz-standard" });
        expect(videoOption).toMatchObject({ provider: "runninghub", channelId: "rh-cn", channelModelKey: "rh-upscale" });
    });

    test("freezes the selected RunningHub channel and model in batch parameters", () => {
        const node = {
            id: "video-source",
            type: CanvasNodeType.Video,
            title: "source",
            position: { x: 0, y: 0 },
            width: 640,
            height: 360,
        } as CanvasNodeData;
        const settings = {
            ...createDefaultUpscaleSettings(),
            video: {
                mode: "precision" as const,
                model: "rh-cn::rh-upscale",
                provider: "runninghub" as const,
                channelId: "rh-cn",
                channelModelKey: "rh-upscale",
                enhancementModel: "high" as const,
            },
        };
        expect(upscaleParamsForNode(settings, node, "resource-1")).toMatchObject({
            resourceId: "resource-1",
            provider: "runninghub",
            channelId: "rh-cn",
            channelModelKey: "rh-upscale",
            enhancementModel: "high",
        });
    });
});
