import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import { resourceFileUrl } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

import { promptWithoutAssetMentions } from "./smart-film-storyboard-prompt";
import { buildShotAssetReferenceContext, projectAssetReferenceImage } from "./workflow-shot-references";
import { currentRevision } from "./workflow-shared";

type StoryboardEntry = {
    shot: ProjectShot;
    artifact?: ShotArtifact;
};

export function buildSmartFilmWholeFilmPrompt(
    detail: ProjectDetail,
    entries: StoryboardEntry[],
    targetSeconds: number,
    options: { maxChars?: number; inputAssetRoles?: Record<string, string>; inputAssetNames?: Record<string, string> } = {},
) {
    const maxChars = Math.max(1_000, Math.floor(options.maxChars || 4_000));
    const assetReferences = collectVisualAssetReferences(detail, entries, options.inputAssetRoles, options.inputAssetNames);
    const assetReferenceIndexById = new Map(assetReferences.map((reference, index) => [reference.assetId, index + 1]));
    const storyboardReferenceOffset = assetReferences.length;
    const storyboardEntries = entries.map((entry, shotIndex) => ({ ...entry, shotIndex })).filter((entry) => entry.artifact?.resourceId && entry.artifact.status === "ready");
    const storyboardImages: ReferenceImage[] = storyboardEntries.map(({ shot, artifact, shotIndex }) => ({
        id: `smart-film-storyboard-${shotIndex}`,
        name: `镜头${shotIndex + 1}分镜参考 · ${shot.title}`,
        type: "image/*",
        dataUrl: "",
        url: resourceFileUrl(artifact!.resourceId!),
        storageKey: `resource:${artifact!.resourceId}`,
    }));
    const referenceImages = [
        ...assetReferences.map((reference, index) => ({
            ...reference.image,
            id: `smart-film-asset-${reference.assetId}`,
            name: `${reference.category === "prop" ? "产品外观参考" : "人物外观参考"}${index + 1}`,
        })),
        ...storyboardImages,
    ];
    const timings = smartFilmShotTimings(entries, targetSeconds);
    const intro = `生成一段完整的 ${formatSeconds(targetSeconds)} 秒视频。参考图编号与镜头编号是两套编号，不得混用。`;
    const referenceMap = [
        "【参考图职责】",
        ...assetReferences.map((reference, index) => `参考图${index + 1}：项目绑定的${assetReferenceRoleLabel(reference.category)}外观设定（${reference.title}），锁定该实体的身份、结构、颜色、材质和标志。`),
        ...storyboardEntries.map(({ shotIndex }, index) => `参考图${storyboardReferenceOffset + index + 1}对应镜头${shotIndex + 1}，用于该镜头的构图、动作结果、环境与光效。`),
    ].join("\n");
    const continuityRules = [
        "【实体与多视图规则】",
        "如果主体外观参考呈现三视图、转面图或多角度设定页，所有视角都是同一角色或产品的不同视图，只用于理解同一实体的外形；不得按视图数量复制角色或产品，也不得把设定页排版当作成片场景。",
        "主体外观参考优先锁定身份与结构；分镜参考只控制对应镜头的构图、动作、环境和光线，不得把分镜图里的主体复制成多个实体。",
        "产品参考图中的产品必须在符合剧情的镜头中清晰可见，保持外形、颜色、材质与标志一致；人物必须与对应人物参考图保持一致。",
    ].join("\n");
    const outro = "仅保留已写明的对白；没有对白时不新增对白或旁白。动作音效、环境声和配乐服务于画面，不得覆盖主体动作。";
    const dialogue = compactDialogue(detail, entries, Math.min(600, Math.floor(maxChars * 0.15)));
    const fixedLength = intro.length + referenceMap.length + continuityRules.length + outro.length + dialogue.length + entries.length * 24;
    const taskBudget = maxChars;
    const cueBudget = Math.max(20, Math.floor((taskBudget - fixedLength) / Math.max(1, entries.length)));
    const entityLocks = assetReferences
        .filter((reference) => reference.category === "prop" || reference.category === "character")
        .map((reference, index) => `${reference.category === "prop" ? "产品/道具" : "人物"}“${reference.title}”外观以参考图${index + 1}为准`)
        .join("；");
    const shotPrompts = entries.map(({ shot }, index) => {
        const revision = currentRevision(detail, shot);
        const source = [
            revision?.videoPrompt || revision?.plotDescription || shot.description || shot.title,
            revision?.action || "",
        ].filter(Boolean).join("\n");
        const cue = fitText([entityLocks, smartFilmShotDirection(source, assetReferenceIndexById)].filter(Boolean).join("；"), cueBudget);
        const timing = timings[index];
        return `镜头${index + 1}（${formatSeconds(timing.start)}–${formatSeconds(timing.end)} 秒）：${cue}`;
    });
    const taskPrompt = [
        intro,
        referenceMap,
        continuityRules,
        ...shotPrompts,
        dialogue ? `对白顺序：${dialogue}` : "",
        outro,
    ].filter(Boolean).join("\n");
    const prompt = compileSmartFilmWholeFilmPrompt(taskPrompt, maxChars);
    if (prompt.length > maxChars || !prompt.includes(taskPrompt)) {
        throw new Error("镜头和参考图过多，完整提示词超过当前视频模型的长度上限，请更换模型或减少镜头与参考图");
    }
    const missingInputAssets = Object.entries(options.inputAssetRoles || {})
        .filter(([, role]) => role === "product" || role === "character")
        .filter(([assetId]) => !assetReferenceIndexById.has(assetId))
        .map(([assetId]) => options.inputAssetNames?.[assetId] || assetId);

    return {
        missingInputAssets,
        prompt,
        taskPrompt,
        referenceImages,
        storyboardResourceIds: storyboardEntries.map(({ artifact }) => artifact!.resourceId!),
    };
}

export function compileSmartFilmWholeFilmPrompt(taskPrompt: string, maxChars: number) {
    const prompt = taskPrompt.trim();
    if (prompt.length > maxChars) {
        throw new Error("镜头和参考图过多，完整提示词超过当前视频模型的长度上限，请更换模型或减少镜头与参考图");
    }
    return prompt;
}

export function smartFilmShotTimings(entries: StoryboardEntry[], targetSeconds: number) {
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

export function smartFilmShotDirection(value: string, assetReferenceIndexById?: ReadonlyMap<string, number>) {
    const normalized = value
        .replace(/@\[asset:([^\]]+)\]/g, (_token, assetId: string) => {
            const referenceIndex = assetReferenceIndexById?.get(assetId.trim());
            return referenceIndex ? `外观以参考图${referenceIndex}为准` : "";
        })
        .replace(/Generate a (\d+(?:\.\d+)?)-second cinematic shot\.?/gi, "生成一段$1秒电影感镜头。")
        .replace(/图片\s*\d+\s*=\s*生成图片中的(产品|人物|角色|道具)/g, "画面中的$1")
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
        return dialogue ? [`镜头${index + 1}「${fitText(dialogue, 72)}」`] : [];
    });
    return fitText(parts.join("；"), budget);
}

function collectVisualAssetReferences(detail: ProjectDetail, entries: StoryboardEntry[], inputAssetRoles?: Record<string, string>, inputAssetNames?: Record<string, string>) {
    const seen = new Set<string>();
    const references: Array<{ assetId: string; category: string; title: string; image: ReferenceImage }> = [];
    for (const asset of detail.assets) {
        const role = inputAssetRoles?.[asset.id];
        if (role !== "product" && role !== "character") continue;
        const image = projectAssetReferenceImage(asset);
        if (!image) continue;
        seen.add(asset.id);
        references.push({ assetId: asset.id, category: role === "product" ? "prop" : "character", title: inputAssetNames?.[asset.id] || asset.title, image });
    }
    for (const { shot } of entries) {
        const context = buildShotAssetReferenceContext(detail, shot.id);
        for (const reference of context.assetReferences) {
            if (seen.has(reference.assetId)) continue;
            const image = context.referenceImages[reference.imageIndex - 1];
            if (!image) continue;
            seen.add(reference.assetId);
            references.push({ assetId: reference.assetId, category: reference.category, title: reference.title, image });
        }
    }
    return references;
}

function assetReferenceRoleLabel(category: string) {
    if (category === "character") return "人物身份与造型";
    if (category === "scene" || category === "environment") return "场景外观";
    if (category === "prop") return "产品/道具";
    return "主体";
}

function fitText(value: string, maxChars: number) {
    const normalized = value.trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatSeconds(value: number) {
    return String(Math.round(Math.max(0, value) * 10) / 10);
}
