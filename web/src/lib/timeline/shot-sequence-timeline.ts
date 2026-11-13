import { resourceFileUrl } from "@/services/api/resources";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import type { TimelineClip, TimelineProject, TimelineTrack } from "@/types/timeline";

const VIDEO_TRACK_ID = "t-video";
const AUDIO_TRACK_ID = "t-audio";
const BGM_TRACK_ID = "t-bgm";
const SUBTITLE_TRACK_ID = "t-subtitle";

/**
 * 成片编排的阻塞项。缺片或产物未就绪时不出片——补黑场会让成片时长与分镜对不上，
 * 且缺片容易被忽略，因此这里只报告问题，由调用方决定是否禁用成片入口。
 */
export type DeliveryIssue =
    | { kind: "missing_video"; shotId: string; title: string }
    | { kind: "video_not_ready"; shotId: string; title: string; status: string }
    | { kind: "zero_duration"; shotId: string; title: string };

export type DeliveryTimelineInput = Pick<ProjectDetail, "shots" | "shotArtifacts" | "shotRevisions">;

export type DeliveryTimeline = {
    timeline: TimelineProject;
    issues: DeliveryIssue[];
    /** 本章镜头总数，用于展示「就绪 N / 共 M」。 */
    shotCount: number;
};

/**
 * 把本章镜头按 `position` 顺序编成服务端渲染用的时间线。
 *
 * 只决定「放哪些片段、按什么顺序、各多长」；实际拼接由后端 timeline_render
 * 任务完成（ffmpeg concat + libx264）。因此这里必须产出合法的 TimelineProject，
 * 而不是本地 ffmpeg.wasm 的步骤计划。
 */
export function buildDeliveryTimeline(detail: DeliveryTimelineInput, unitId: string): DeliveryTimeline {
    const shots = (detail.shots || [])
        .filter((shot) => !unitId || shot.unitId === unitId)
        .slice()
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));

    const issues: DeliveryIssue[] = [];
    const clips: TimelineClip[] = [];
    let cursor = 0;

    for (const shot of shots) {
        const artifact = currentVideoArtifact(detail, shot.id);
        if (!artifact) {
            issues.push({ kind: "missing_video", shotId: shot.id, title: shot.title });
            continue;
        }
        const resourceId = (artifact.resourceId || "").trim();
        if (artifact.status !== "ready" || !resourceId) {
            issues.push({ kind: "video_not_ready", shotId: shot.id, title: shot.title, status: artifact.status });
            continue;
        }
        const durationMs = resolveShotDurationMs(artifact, shot);
        if (durationMs <= 0) {
            issues.push({ kind: "zero_duration", shotId: shot.id, title: shot.title });
            continue;
        }

        clips.push({
            id: `clip-${shot.id}`,
            kind: "video",
            nodeId: shot.id,
            trackId: VIDEO_TRACK_ID,
            startMs: cursor,
            durationMs,
            title: shot.title,
            sourceStartMs: 0,
            // storageKey 必须是 resource:<id> 形态：后端 mediaResourceID 只认这个前缀，
            // 否则该片段会被当成无媒体并渲染成黑场。
            directMedia: {
                id: shot.id,
                kind: "video",
                title: shot.title,
                storageKey: `resource:${resourceId}`,
                url: resourceFileUrl(resourceId),
                durationMs,
            },
        });

        const audio = currentAudioArtifact(detail, shot.id);
        if (audio?.status === "ready" && audio.resourceId) {
            clips.push({
                id: `audio-${shot.id}`,
                kind: "audio",
                nodeId: shot.id,
                trackId: AUDIO_TRACK_ID,
                startMs: cursor,
                durationMs,
                title: `${shot.title} · 旁白`,
                sourceStartMs: 0,
                volume: 1,
                directMedia: {
                    id: shot.id,
                    kind: "audio",
                    title: `${shot.title} · 旁白`,
                    storageKey: `resource:${audio.resourceId}`,
                    url: resourceFileUrl(audio.resourceId),
                    durationMs,
                },
            });
        }

        const dialogue = resolveDialogue(detail, shot);
        if (dialogue) {
            clips.push({
                id: `subtitle-${shot.id}`,
                kind: "subtitle",
                nodeId: shot.id,
                trackId: SUBTITLE_TRACK_ID,
                startMs: cursor,
                durationMs,
                text: dialogue,
            });
        }

        cursor += durationMs;
    }

    const music = currentBgmArtifact(detail, unitId);
    if (cursor > 0 && music?.status === "ready" && music.resourceId) {
        clips.push({
            id: `bgm-${unitId}`,
            kind: "audio",
            nodeId: music.shotId,
            trackId: BGM_TRACK_ID,
            startMs: 0,
            durationMs: cursor,
            title: "背景音乐",
            sourceStartMs: 0,
            volume: 0.18,
            fadeInMs: 500,
            fadeOutMs: 1200,
            directMedia: {
                id: music.shotId,
                kind: "audio",
                title: "背景音乐",
                storageKey: `resource:${music.resourceId}`,
                url: resourceFileUrl(music.resourceId),
                durationMs: cursor,
            },
        });
    }

    const tracks: TimelineTrack[] = [
        { id: VIDEO_TRACK_ID, kind: "video", label: "成片", order: 0 },
        ...(clips.some((clip) => clip.kind === "audio" && clip.trackId === AUDIO_TRACK_ID) ? [{ id: AUDIO_TRACK_ID, kind: "audio" as const, label: "旁白", order: 1 }] : []),
        ...(clips.some((clip) => clip.kind === "audio" && clip.trackId === BGM_TRACK_ID) ? [{ id: BGM_TRACK_ID, kind: "audio" as const, label: "配乐", order: 2 }] : []),
        { id: SUBTITLE_TRACK_ID, kind: "subtitle", label: "字幕", order: 3 },
    ];

    return {
        timeline: { version: 2, tracks, clips, durationMs: cursor },
        issues,
        shotCount: shots.length,
    };
}

/** 取镜头当前选中的视频产物；没有标记 selected 时退到版本号最高的一个。 */
function currentVideoArtifact(detail: DeliveryTimelineInput, shotId: string): ShotArtifact | undefined {
    const artifacts = (detail.shotArtifacts || [])
        .filter((item) => item.shotId === shotId && item.type === "video")
        .slice()
        .sort((left, right) => right.version - left.version);
    return artifacts.find((item) => item.selected) || artifacts[0];
}

function currentAudioArtifact(detail: DeliveryTimelineInput, shotId: string): ShotArtifact | undefined {
    const artifacts = (detail.shotArtifacts || [])
        .filter((item) => item.shotId === shotId && item.type === "audio" && audioArtifactPurpose(item) !== "music")
        .slice()
        .sort((left, right) => right.version - left.version);
    return artifacts.find((item) => item.selected) || artifacts[0];
}

function currentBgmArtifact(detail: DeliveryTimelineInput, unitId: string): ShotArtifact | undefined {
    const artifacts = (detail.shotArtifacts || [])
        .filter((item) => item.unitId === unitId && item.type === "audio" && audioArtifactPurpose(item) === "music")
        .slice()
        .sort((left, right) => right.version - left.version);
    return artifacts.find((item) => item.selected) || artifacts[0];
}

function audioArtifactPurpose(artifact: ShotArtifact) {
    if (!artifact.metadataJson) return "";
    try {
        const parsed: unknown = JSON.parse(artifact.metadataJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
        const purpose = (parsed as Record<string, unknown>).audioPurpose;
        return typeof purpose === "string" ? purpose : "";
    } catch {
        return "";
    }
}

/**
 * 优先用产物登记时写入的 `durationSeconds`（工作台按用户填写的时长提交），
 * 缺失时回退镜头的时长字段。两者都无效时由调用方判为零时长。
 */
function resolveShotDurationMs(artifact: ShotArtifact, shot: ProjectShot): number {
    const declared = declaredDurationSeconds(artifact);
    if (declared !== undefined && declared > 0) return Math.round(declared * 1000);
    const fallback = Number(shot.durationMs);
    return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 0;
}

function declaredDurationSeconds(artifact: ShotArtifact): number | undefined {
    if (!artifact.metadataJson) return undefined;
    try {
        const parsed: unknown = JSON.parse(artifact.metadataJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
        const raw = (parsed as Record<string, unknown>).durationSeconds;
        const value = typeof raw === "string" ? Number(raw) : raw;
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    } catch {
        // 产物元数据由后端写入，格式异常时按缺失处理，不让整条成片链路失败。
        return undefined;
    }
}

/** 台词取当前修订版本；换行会让 SRT 条目断裂，压成单行。 */
function resolveDialogue(detail: DeliveryTimelineInput, shot: ProjectShot): string {
    const revision = currentRevision(detail, shot);
    return (revision?.dialogue || "").replace(/\s*\r?\n\s*/g, " ").trim();
}

function currentRevision(detail: DeliveryTimelineInput, shot: ProjectShot) {
    const revisions = detail.shotRevisions || [];
    return revisions.find((item) => item.id === shot.currentRevisionId)
        || revisions.filter((item) => item.shotId === shot.id).slice().sort((left, right) => right.version - left.version)[0];
}
