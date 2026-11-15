import { buildDeliveryTimeline, type DeliveryTimelineInput } from "./shot-sequence-timeline";
import { normalizeTimelineProject } from "./timeline-tracks";
import type { TimelineProject } from "@/types/timeline";

export type EditorTimelineSource = "stored" | "delivery" | "empty";

export type EditorTimelineResolution = {
    timeline: TimelineProject;
    source: EditorTimelineSource;
    /** 本地记录损坏时保留错误供页面告警；不影响从交付数据回退。 */
    storedError?: unknown;
};

export function createEmptyEditorTimeline(): TimelineProject {
    return normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 });
}

/**
 * 编辑器装载顺序：优先保留用户本地时间线；仅在没有有效本地记录时，
 * 从交付页传入的当前章节镜头自动铺轨，避免每次进入都覆盖手工剪辑。
 */
export function resolveEditorTimeline(input: {
    storedRaw?: string | null;
    delivery?: DeliveryTimelineInput;
    unitId?: string;
    aspectRatio?: string;
}): EditorTimelineResolution {
    let storedError: unknown;
    const raw = input.storedRaw?.trim();
    if (raw) {
        try {
            return { timeline: normalizeTimelineProject(JSON.parse(raw)), source: "stored" };
        } catch (error) {
            storedError = error;
        }
    }

    if (input.delivery && input.unitId) {
        const delivery = buildDeliveryTimeline(input.delivery, input.unitId, { aspectRatio: input.aspectRatio });
        if (delivery.timeline.clips.length > 0 && delivery.issues.length === 0) {
            return { timeline: delivery.timeline, source: "delivery", storedError };
        }
    }

    return { timeline: createEmptyEditorTimeline(), source: "empty", storedError };
}
