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
