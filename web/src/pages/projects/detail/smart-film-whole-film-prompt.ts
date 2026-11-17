import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import { resourceFileUrl } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

import { promptWithoutAssetMentions } from "./smart-film-storyboard-prompt";
import { currentRevision } from "./workflow-shared";

type StoryboardEntry = {
    shot: ProjectShot;
    artifact: ShotArtifact;
};

export function buildSmartFilmWholeFilmPrompt(
    detail: ProjectDetail,
    entries: StoryboardEntry[],
    targetSeconds: number,
    options: { maxChars?: number } = {},
) {
    const maxChars = Math.max(1_000, Math.floor(options.maxChars || 4_000));
    const referenceImages: ReferenceImage[] = entries.map(({ shot, artifact }, shotIndex) => ({
            id: `smart-film-storyboard-${shotIndex}`,
            name: `图片${shotIndex + 1} · ${shot.title}`,
            type: "image/*",
            dataUrl: "",
            url: resourceFileUrl(artifact.resourceId!),
            storageKey: `resource:${artifact.resourceId}`,
    }));
    const timings = shotTimings(entries, targetSeconds);
    const intro = `参考图片1至图片${entries.length}，生成一个完整的 ${formatSeconds(targetSeconds)} 秒视频。把这些图片作为同一部作品的有序视觉参考，保持角色、产品、场景、画风和光线一致；允许模型按动作连续性自然衔接，不要求每张图片对应固定硬切点。`;
    const outro = "保留对白、动作音效、环境声和项目设定的背景音乐，不新增无关旁白。";
    const dialogue = compactDialogue(detail, entries, Math.min(600, Math.floor(maxChars * 0.15)));
    const fixedLength = intro.length + outro.length + dialogue.length + entries.length * 24;
    const cueBudget = Math.max(72, Math.floor((maxChars - fixedLength) / Math.max(1, entries.length)));
    const shotPrompts = entries.map(({ shot }, index) => {
        const revision = currentRevision(detail, shot);
        const source = [
            revision?.videoPrompt || revision?.plotDescription || shot.description || shot.title,
            revision?.action || "",
        ].filter(Boolean).join("\n");
        const cue = fitText(primaryShotDirection(source), cueBudget);
        const timing = timings[index];
        return `图片${index + 1}（${formatSeconds(timing.start)}–${formatSeconds(timing.end)} 秒）：${cue}`;
    });
    const prompt = [
        intro,
        ...shotPrompts,
        dialogue ? `对白顺序：${dialogue}` : "",
        outro,
    ].filter(Boolean).join("\n");

    return {
        prompt: prompt.slice(0, maxChars),
        referenceImages,
        storyboardResourceIds: entries.map(({ artifact }) => artifact.resourceId!),
    };
}

function shotTimings(entries: StoryboardEntry[], targetSeconds: number) {
    const rawDurations = entries.map(({ shot }) => Math.max(0.1, shot.durationMs / 1000));
    const total = rawDurations.reduce((sum, value) => sum + value, 0) || entries.length;
    let cursor = 0;
    return rawDurations.map((duration, index) => {
        const start = cursor;
        const end = index === entries.length - 1
            ? targetSeconds
            : Math.min(targetSeconds, cursor + duration / total * targetSeconds);
        cursor = end;
        return { start, end };
    });
}

function primaryShotDirection(value: string) {
    const normalized = promptWithoutAssetMentions(value)
        .replace(/\r/g, "")
        .replace(/[ \t]+/g, " ")
        .trim();
    const section = normalized.search(/\n\s*(?:叙事意图|表演调度|时间节拍|动作与时间节拍|情绪|光线与氛围|声音|【镜头台词】)[：:]?/);
    return (section > 0 ? normalized.slice(0, section) : normalized).replace(/\s+/g, " ").trim();
}

function compactDialogue(detail: ProjectDetail, entries: StoryboardEntry[], budget: number) {
    const parts = entries.flatMap(({ shot }, index) => {
        const dialogue = promptWithoutAssetMentions(currentRevision(detail, shot)?.dialogue || "")
            .replace(/\s+/g, " ")
            .trim();
        return dialogue ? [`图片${index + 1}「${fitText(dialogue, 72)}」`] : [];
    });
    return fitText(parts.join("；"), budget);
}

function fitText(value: string, maxChars: number) {
    const normalized = value.trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatSeconds(value: number) {
    return String(Math.round(Math.max(0, value) * 10) / 10);
}
