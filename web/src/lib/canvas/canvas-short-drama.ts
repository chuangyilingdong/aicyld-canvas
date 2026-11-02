import { nanoid } from "nanoid";

import { createCanvasNode, createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { scopedLocalStorage } from "@/lib/user-scope";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

const SHORT_DRAMA_GUIDE_STORAGE_KEY = "canvas-short-drama-guide-v1";

export type CanvasShortDramaStepId = "style" | "story" | "storyboard" | "video" | "final";
export type CanvasShortDramaStepStatus = "pending" | "current" | "completed";
export type CanvasShortDramaStep = {
    id: CanvasShortDramaStepId;
    label: string;
    status: CanvasShortDramaStepStatus;
    nodeId?: string;
};

export type CanvasShortDramaProgress = {
    active: boolean;
    completed: boolean;
    completedCount: number;
    steps: CanvasShortDramaStep[];
};

export function createShortDramaPipeline(center: Position) {
    const styleNode = createCanvasNode(CanvasNodeType.Text, { x: center.x - 760, y: center.y - 170 }, {
        content: "",
        status: "idle",
        workflowKind: "styleboard",
        workflowTitle: "项目画风",
        workflowDescription: "待选择",
        fontSize: 14,
    });
    styleNode.title = "项目画风 · 待选择";
    styleNode.width = 360;
    styleNode.height = 220;

    const storyNode = createCanvasNode(CanvasNodeType.Text, { x: center.x - 760, y: center.y + 170 }, {
        content: "",
        status: "idle",
        workflowKind: "story_input",
        workflowTitle: "故事输入",
        workflowDescription: "题材、角色、冲突和结局方向",
        fontSize: 14,
    });
    storyNode.title = "故事梗概";
    storyNode.width = 420;
    storyNode.height = 260;

    const scriptNode = createCanvasNode(CanvasNodeType.Script, { x: center.x + 180, y: center.y }, {
        status: "idle",
        workflowKind: "storyboard",
        workflowTitle: "分镜脚本",
        storyboard: {
            rows: [],
            visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
            referenceNodeIds: [],
        },
    });
    scriptNode.title = "分镜脚本 · 待生成";

    const connections: CanvasConnection[] = [
        { id: nanoid(), fromNodeId: styleNode.id, toNodeId: scriptNode.id, toHandleId: "storyboard:context" },
        { id: nanoid(), fromNodeId: storyNode.id, toNodeId: scriptNode.id, toHandleId: "storyboard:context" },
    ];
    return { nodes: [styleNode, storyNode, scriptNode], connections, styleNodeId: styleNode.id, storyNodeId: storyNode.id, scriptNodeId: scriptNode.id };
}

export function createShortDramaDemo(center: Position) {
    const pipeline = createShortDramaPipeline(center);
    const [styleNode, storyNode, scriptNode] = pipeline.nodes;
    styleNode.title = "项目画风 · 电影感东方奇幻";
    styleNode.metadata = {
        ...styleNode.metadata,
        content: "电影感东方奇幻：低饱和青灰与暖金侧逆光，细腻胶片颗粒，克制表演，近景优先。",
        workflowDescription: "电影感东方奇幻",
    };
    storyNode.title = "故事梗概 · 示例";
    storyNode.metadata = {
        ...storyNode.metadata,
        content: "雨夜，年轻画师在旧宅发现一幅会改变天气的古画。画中女子请求他把最后一笔补完，而门外追债的人已经上楼。他必须在毁画自保与完成约定之间做出选择。",
    };
    scriptNode.title = "分镜脚本 · 示例（3 镜）";
    scriptNode.metadata = {
        ...scriptNode.metadata,
        storyboard: {
            rows: [
                createStoryboardRow(1, {
                    durationSeconds: 5,
                    plotDescription: "雨夜旧宅，画师推门而入，怀里的古画滑落展开。",
                    dialogue: "旁白：那幅画，从他进门的一刻就开始下雨。",
                    characters: [{ characterName: "画师" }],
                    narrativeIntent: "建立悬念和古画异常",
                    shotSize: "中景",
                    emotion: "警觉、迟疑",
                    lightingAndAtmosphere: "冷蓝雨夜，门缝透出暖黄灯",
                    camera: "缓慢跟拍",
                    motion: "雨水沿窗滑落，画纸边缘轻轻卷动",
                    imageGenerationPrompt: "雨夜旧式书房，年轻画师抱着卷轴推门而入，冷蓝环境光与暖黄台灯，电影感东方奇幻，中景。",
                    videoMotionPrompt: "镜头从门外缓慢跟随画师进入，雨水沿窗滑落，画纸边缘被风吹动。",
                    status: "idle",
                }),
                createStoryboardRow(2, {
                    durationSeconds: 5,
                    plotDescription: "古画展开，画中女子抬眼看向画外，墨色水面泛起波纹。",
                    dialogue: "画中女子：只差最后一笔。",
                    characters: [{ characterName: "画师" }, { characterName: "画中女子" }],
                    narrativeIntent: "提出任务和超自然规则",
                    shotSize: "近景",
                    emotion: "惊惧转为专注",
                    lightingAndAtmosphere: "画纸发出微弱青金色光",
                    camera: "俯拍推近",
                    motion: "女子眼睫轻颤，墨色水面扩散一圈波纹",
                    imageGenerationPrompt: "俯拍展开的古画，画中女子抬眼，墨色水面泛起青金色波纹，电影感微距细节。",
                    videoMotionPrompt: "镜头俯拍缓慢推近古画，女子眼睫轻颤，墨纹一圈圈扩散。",
                    status: "idle",
                }),
                createStoryboardRow(3, {
                    durationSeconds: 6,
                    plotDescription: "门外脚步声逼近，画师提笔，最后一滴墨悬在纸上。",
                    dialogue: "画师：这一笔落下去，我就回不了头了。",
                    characters: [{ characterName: "画师" }],
                    narrativeIntent: "把外部威胁与承诺冲突推到选择点",
                    shotSize: "中近景",
                    emotion: "紧张、下定决心",
                    lightingAndAtmosphere: "台灯闪烁，门口出现压迫阴影",
                    camera: "手持轻晃",
                    motion: "笔尖悬停，墨滴拉长，门口阴影停住",
                    imageGenerationPrompt: "年轻画师提笔悬在古画上方，门口投下陌生人的阴影，台灯闪烁，电影感东方奇幻中近景。",
                    videoMotionPrompt: "手持轻晃镜头，笔尖墨滴拉长，门口阴影逐渐停住，最后一下脚步声收尾。",
                    status: "idle",
                }),
            ],
            visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
            referenceNodeIds: [styleNode.id, storyNode.id],
        },
    };
    return {
        title: "示例：小说改编漫剧",
        nodes: pipeline.nodes,
        connections: pipeline.connections,
    };
}

export function deriveShortDramaProgress(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasShortDramaProgress {
    const storyInputNode = nodes.find((node) => node.metadata?.workflowKind === "story_input");
    const storyboardScripts = nodes.filter((node) => node.type === CanvasNodeType.Script && (node.metadata?.workflowKind === "storyboard" || Boolean(storyInputNode)));
    const agentScriptNode = nodes.find((node) => node.type === CanvasNodeType.Text && node.metadata?.workflowKind === "script");
    const shotNodes = nodes.filter((node) => node.metadata?.workflowKind === "shot");
    const finalNodes = nodes.filter((node) => node.metadata?.workflowKind === "final");
    const hasManualPipeline = Boolean(storyInputNode || storyboardScripts.some((node) => node.metadata?.workflowKind === "storyboard"));
    const hasAgentPipeline = Boolean(agentScriptNode && shotNodes.length && finalNodes.length);
    const active = hasManualPipeline || hasAgentPipeline;
    const scriptIds = new Set(storyboardScripts.map((node) => node.id));
    const isConnectedToStoryboard = (nodeId: string) => connections.some((connection) => connection.fromNodeId === nodeId && scriptIds.has(connection.toNodeId));
    const styleNode = nodes.find((node) => node.metadata?.workflowKind === "styleboard");
    const storyNode = storyInputNode || agentScriptNode;
    const scriptNode = storyboardScripts.find((node) => meaningfulStoryboardRows(node).length > 0) || storyboardScripts[0];
    const meaningfulRows = scriptNode ? meaningfulStoryboardRows(scriptNode) : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const successfulVideoNodeIds = new Set(nodes.filter(isSuccessfulVideoNode).map((node) => node.id));
    const completedShotVideos = nodes.filter((node) => isSuccessfulVideoNode(node) && (node.metadata?.workflowKind === "shot" || connections.some((connection) => shotNodes.some((shot) => shot.id === connection.fromNodeId) && connection.toNodeId === node.id)));
    const finalNode = finalNodes.find((node) => node.metadata?.status === "success" && Boolean(node.metadata.content));

    const storyText = (storyNode?.metadata?.content || "").trim();
    // 手工流水线要求输入真实连到分镜脚本；Agent 协议的风格板和剧本没有这条连线，按领域节点本身判断。
    const styleDone = Boolean((styleNode?.metadata?.content || styleNode?.metadata?.prompt || "").trim() && (hasAgentPipeline || !scriptNode || isConnectedToStoryboard(styleNode!.id)));
    const storyDone = Boolean(storyText && storyNode && (storyNode === agentScriptNode || !scriptNode || isConnectedToStoryboard(storyNode.id)));
    const storyboardDone = meaningfulRows.length > 0 || shotNodes.length > 0;
    const rowsWithVideo = meaningfulRows.filter((row) => row.videoNodeId && nodeById.get(row.videoNodeId)?.type === CanvasNodeType.Video);
    const videoDone = meaningfulRows.length > 0
        ? rowsWithVideo.length === meaningfulRows.length && rowsWithVideo.every((row) => {
              const videoNode = nodeById.get(row.videoNodeId!);
              return videoNode?.metadata?.status === "success" && Boolean(videoNode.metadata.content);
          })
        : shotNodes.length > 0 && shotNodes.every((shot) => connections.some((connection) => connection.fromNodeId === shot.id && successfulVideoNodeIds.has(connection.toNodeId)));
    const done = [styleDone, storyDone, storyboardDone, videoDone, Boolean(finalNode)];
    const firstIncomplete = done.findIndex((value) => !value);
    const firstShotNode = shotNodes[0];
    const definitions: Array<{ id: CanvasShortDramaStepId; label: string; nodeId?: string }> = [
        { id: "style", label: "选择画风", nodeId: styleNode?.id },
        { id: "story", label: "输入故事", nodeId: storyNode?.id },
        { id: "storyboard", label: "生成分镜", nodeId: scriptNode?.id || firstShotNode?.id },
        { id: "video", label: "生成视频", nodeId: scriptNode?.id || firstShotNode?.id || completedShotVideos[0]?.id },
        { id: "final", label: "合并成片", nodeId: finalNode?.id || finalNodes[0]?.id || completedShotVideos[0]?.id },
    ];
    const steps = definitions.map((step, index): CanvasShortDramaStep => ({
        ...step,
        status: done[index] ? "completed" : index === firstIncomplete ? "current" : "pending",
    }));
    return {
        active,
        completed: done.every(Boolean),
        completedCount: done.filter(Boolean).length,
        steps,
    };
}

export function readShortDramaGuideDismissed() {
    try {
        return scopedLocalStorage.getItem(SHORT_DRAMA_GUIDE_STORAGE_KEY) === "dismissed";
    } catch (error) {
        console.warn("读取短剧导引状态失败", error);
        return false;
    }
}

export function persistShortDramaGuideDismissed() {
    try {
        scopedLocalStorage.setItem(SHORT_DRAMA_GUIDE_STORAGE_KEY, "dismissed");
    } catch (error) {
        console.warn("保存短剧导引状态失败", error);
    }
}

function meaningfulStoryboardRows(node: CanvasNodeData) {
    return (node.metadata?.storyboard?.rows || []).filter((row) => Boolean((row.plotDescription || row.imageGenerationPrompt || row.videoMotionPrompt).trim()));
}

function isSuccessfulVideoNode(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && node.metadata?.status === "success" && Boolean(node.metadata.content);
}
