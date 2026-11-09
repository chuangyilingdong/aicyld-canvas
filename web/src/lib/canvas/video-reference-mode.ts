import type { CanvasNodeMetadata } from "@/types/canvas";

export type VideoReferenceCandidate = {
    nodeId: string;
    kind: "text" | "image" | "video" | "audio" | "character" | "skill";
    label: string;
    title?: string;
    active?: boolean;
};

export type VideoReferenceModeState = {
    mode: "frames" | "all";
    canSelectFrames: boolean;
    canSelectAll: boolean;
    framesDisabledReason?: string;
    allDisabledReason?: string;
    endFrameSupported: boolean;
    startFrameNodeId?: string;
    endFrameNodeId?: string;
    promptFirstFrameNodeId?: string;
};

const PROMPT_FIRST_FRAME_CLAUSE =
    /(?:^|[，,。；;\n\s])(?:以\s*)?(?:@\[node:([^\]]+)\]|@(图片\d+))\s*(?:[:：]?\s*)?作为(?:本镜头(?:的)?|起始)?首帧(?:画面)?/u;

const GLOBAL_FIRST_FRAME_CLAUSE =
    /(?:^|[，,。；;\s]+)(?:以\s*)?(?:@\[node:[^\]]+\]|@图片\d+)\s*(?:[:：]?\s*)?作为(?:本镜头(?:的)?|起始)?首帧(?:画面)?[，,。；;\s]*/gu;

export function findPromptFirstFrameNodeId(prompt: string, imageRefs: VideoReferenceCandidate[]): string | undefined {
    const activeImages = imageRefs.filter((ref) => ref.active !== false && ref.kind === "image");
    const match = PROMPT_FIRST_FRAME_CLAUSE.exec(prompt);
    if (!match) return undefined;
    const [, nodeId, label] = match;
    if (nodeId) {
        return activeImages.find((ref) => ref.nodeId === nodeId)?.nodeId;
    }
    if (label) {
        return activeImages.find((ref) => ref.label.trim() === label.trim())?.nodeId;
    }
    return undefined;
}

export function stripPromptFirstFrameClauses(prompt: string): string {
    return prompt
        .replace(GLOBAL_FIRST_FRAME_CLAUSE, (fullMatch, offset: number) => {
            if (offset === 0) return "";
            const leadingPunct = /^[，,。；;\s]+/u.exec(fullMatch)?.[0] || "";
            return leadingPunct.includes("\n") ? "\n" : "，";
        })
        .replace(/^[，,。；;\s]+/u, "")
        .replace(/[，,。；;\s]+$/u, (tail) => (tail.includes("\n") ? "\n" : ""));
}

export function togglePromptFirstFrameMention(
    prompt: string,
    target: { nodeId: string; token: string },
    imageRefs: VideoReferenceCandidate[],
): string {
    const currentId = findPromptFirstFrameNodeId(prompt, imageRefs);
    const cleaned = stripPromptFirstFrameClauses(prompt);
    if (currentId === target.nodeId) {
        return cleaned;
    }
    const prefix = `${target.token} 作为首帧，`;
    return cleaned ? `${prefix}${cleaned}` : prefix;
}

export type VideoReferenceModeLimits = {
    minImages?: number;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
};

// 用户选择不改写；素材不兼容时返回可展示的具体原因，由调用方阻止提交。
export function videoReferenceModeWarning(
    mode: "frames" | "all",
    references: VideoReferenceCandidate[],
    limits: VideoReferenceModeLimits,
): string {
    const active = references.filter((item) => item.active !== false && item.kind !== "skill");
    const visual = active.filter((item) => item.kind === "image" || item.kind === "character").length;
    const videos = active.filter((item) => item.kind === "video").length;
    const audios = active.filter((item) => item.kind === "audio").length;
    const modeLabel = mode === "frames" ? "首尾帧模式" : "全能参考模式";
    if (mode === "all" && visual + videos + audios === 0) return "全能参考模式至少需要连接 1 个图片、视频或音频素材。";
    const issues: string[] = [];
    if (visual < (limits.minImages || 0)) issues.push(`至少需要 ${limits.minImages} 张图片/角色`);
    if (visual > limits.maxImages) issues.push(`最多支持 ${limits.maxImages} 张图片/角色（当前 ${visual} 个）`);
    if (videos > limits.maxVideos) issues.push(limits.maxVideos > 0 ? `最多支持 ${limits.maxVideos} 个参考视频（当前 ${videos} 个）` : `不支持参考视频（当前 ${videos} 个）`);
    if (audios > limits.maxAudios) issues.push(limits.maxAudios > 0 ? `最多支持 ${limits.maxAudios} 个参考音频（当前 ${audios} 个）` : `不支持参考音频（当前 ${audios} 个）`);
    if (!issues.length) return "";
    return `${modeLabel}${issues.join("；")}。请调整参考素材${mode === "frames" ? "，或切换为全能参考模式" : ""}。`;
}

export function resolveVideoReferenceModeState({
    metadata,
    references,
    endFrameSupported = true,
    referenceVideoSupported = true,
    framesSupported = true,
    h3Style = false,
    prompt = "",
}: {
    metadata?: CanvasNodeMetadata;
    references: VideoReferenceCandidate[];
    endFrameSupported?: boolean;
    referenceVideoSupported?: boolean;
    framesSupported?: boolean;
    h3Model?: boolean;
    h3Style?: boolean;
    prompt?: string;
}): VideoReferenceModeState {
    const active = references.filter((item) => item.active !== false && item.kind !== "skill");
    const imageRefs = active.filter((item) => item.kind === "image");
    // 模式只由模型能力和用户显式选择决定。已连接素材只参与后续兼容校验，
    // 不能把用户选好的首尾帧/全能参考模式自动改掉。
    const canSelectFrames = framesSupported;
    const canSelectAll = !h3Style && referenceVideoSupported;
    const framesDisabledReason = !canSelectFrames ? "当前模型仅支持全能参考模式" : undefined;
    const allDisabledReason = !canSelectAll ? "当前模型仅支持首帧/首尾帧模式，不支持全能参考" : undefined;
    const selectedMode = metadata?.videoEditOperation === "reference_to_video"
        ? "all"
        : metadata?.videoEditOperation === "image_to_video"
          ? "frames"
          : undefined;
    const mode: "frames" | "all" = selectedMode === "all" && canSelectAll
        ? "all"
        : selectedMode === "frames" && canSelectFrames
          ? "frames"
          : canSelectFrames
            ? "frames"
            : "all";

    if (mode === "all") {
        return {
            mode,
            canSelectFrames,
            canSelectAll,
            framesDisabledReason,
            allDisabledReason,
            endFrameSupported,
            promptFirstFrameNodeId: findPromptFirstFrameNodeId(prompt, imageRefs),
        };
    }

    const explicitStart = imageRefs.find((ref) => ref.nodeId === metadata?.videoStartFrameNodeId)?.nodeId;
    const explicitEnd = endFrameSupported
        ? imageRefs.find((ref) => ref.nodeId === metadata?.videoEndFrameNodeId)?.nodeId
        : undefined;
    const hasExplicitFrame = Boolean(explicitStart || explicitEnd);
    const startFrameNodeId = hasExplicitFrame ? explicitStart : imageRefs[0]?.nodeId;
    const endFrameNodeId = hasExplicitFrame
        ? explicitEnd && explicitEnd !== startFrameNodeId
            ? explicitEnd
            : undefined
        : endFrameSupported && imageRefs.length === 2
          ? imageRefs[1]?.nodeId
          : undefined;

    return {
        mode,
        canSelectFrames,
        canSelectAll,
        framesDisabledReason,
        allDisabledReason,
        endFrameSupported,
        startFrameNodeId,
        endFrameNodeId,
    };
}
