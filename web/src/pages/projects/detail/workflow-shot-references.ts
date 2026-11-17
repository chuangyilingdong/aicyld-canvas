import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { assetCategoryLabel, normalizeAssetCategory } from "@/lib/asset-category";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import type { CharacterRepresentation, ProjectAsset, ProjectAssetCandidate, ProjectDetail, ShotAssetReference } from "@/services/api/projects";
import type { AssetCategory } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

export type ShotAssetReferenceContext = {
    mentionReferences: CanvasResourceReference[];
    referenceImages: ReferenceImage[];
    referenceAudios: ReferenceAudio[];
    assetReferences: ShotPromptAssetReference[];
    resolvedCharacterVersions: Array<{ assetId: string; versionId: string }>;
};

export type ShotPromptAssetReference = {
    assetId: string;
    title: string;
    category: string;
    imageIndex: number;
    audioIndex?: number;
    voiceDescription?: string;
    dialogue?: string;
};

const managedShotAssetReferenceMarkers = ["【角色参考】", "【场景与道具参考】", "【资产引用】", "【资产参考】", "【参考图一致性】"];

export function buildShotAssetReferenceContext(detail: ProjectDetail, shotId: string): ShotAssetReferenceContext {
    const assetByVersionId = new Map(detail.assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset]));
    const seenAssetIds = new Set<string>();
    const entries = (detail.shotReferences || []).flatMap((reference) => {
        if (reference.shotId !== shotId || reference.status !== "linked") return [];
        const asset = reference.asset || assetByVersionId.get(reference.assetVersionId);
        if (!asset || seenAssetIds.has(asset.id)) return [];
        const image = projectAssetReferenceImage(asset, reference);
        if (!image) return [];
        seenAssetIds.add(asset.id);
        return [{ asset, image, reference }];
    });

    const referenceAudios: ReferenceAudio[] = [];
    const audioIndexByResourceId = new Map<string, number>();
    const assetReferences = entries.map(({ asset }, index) => {
        const sampleResourceId = stringValue(asset.character?.voice?.profile.sampleResourceId);
        let audioIndex: number | undefined;
        if (sampleResourceId) {
            audioIndex = audioIndexByResourceId.get(sampleResourceId);
            if (!audioIndex) {
                audioIndex = referenceAudios.length + 1;
                audioIndexByResourceId.set(sampleResourceId, audioIndex);
                referenceAudios.push({
                    id: `project-character-voice:${asset.id}`,
                    name: `${asset.title}-声音样本`,
                    type: "audio/*",
                    url: resourceFileUrl(sampleResourceId),
                    storageKey: resourceStorageKey(sampleResourceId),
                });
            }
        }
        return {
            assetId: asset.id,
            title: asset.title,
            category: asset.category,
            imageIndex: index + 1,
            ...(audioIndex ? { audioIndex } : {}),
            ...(asset.character ? { voiceDescription: characterVoiceDescription(asset) } : {}),
        } satisfies ShotPromptAssetReference;
    });

    return {
        mentionReferences: entries.map(({ asset, image }) => ({
            id: `project-asset:${asset.id}`,
            nodeId: "",
            assetId: asset.id,
            kind: asset.character ? "character" : "image",
            label: asset.title,
            title: asset.title,
            previewUrl: image.url,
            storageKey: image.storageKey,
            active: true,
            category: projectAssetCategory(asset.category),
        })),
        referenceImages: entries.map(({ image }) => image),
        referenceAudios,
        assetReferences,
        resolvedCharacterVersions: entries.flatMap(({ asset, reference }) => asset.character ? [{ assetId: asset.id, versionId: reference.referencedVersion?.id || reference.assetVersionId || asset.character.versionId }] : []),
    };
}

export function stripUnboundShotAssetMentions(prompt: string, context: ShotAssetReferenceContext) {
    const boundAssetIds = new Set(context.mentionReferences.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
    return prompt
        .replace(/@\[asset:([^\]]+)\]/g, (token, assetId: string) => boundAssetIds.has(assetId) ? token : "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([，。；：、！？])/g, "$1")
        .trim();
}

export function missingPrimaryProductReferences(prompt: string, projectName: string, references: Array<Pick<CanvasResourceReference, "category">>, candidates: ProjectAssetCandidate[]) {
    const projectKey = projectName.toLocaleLowerCase();
    const promptKey = prompt.toLocaleLowerCase();
    const primaryProductNames = Array.from(new Set(candidates
        .filter((candidate) => candidate.category === "prop" && candidate.status !== "ignored")
        .map((candidate) => candidate.name.trim())
        .filter((name) => name && projectKey.includes(name.toLocaleLowerCase()) && promptKey.includes(name.toLocaleLowerCase()))));
    if (!primaryProductNames.length) return [];
    return references.some((reference) => reference.category === "prop") ? [] : primaryProductNames;
}

export function smartFilmPrimaryProductName(inputAssetRoles: Record<string, string> | undefined, inputAssetNames: Record<string, string> | undefined, candidates: ProjectAssetCandidate[], projectName: string) {
    const names = new Set<string>();
    for (const [assetId, role] of Object.entries(inputAssetRoles || {})) {
        if (role !== "product") continue;
        const name = meaningfulReferenceName(inputAssetNames?.[assetId]);
        if (name) names.add(name);
    }
    if (names.size === 1) return Array.from(names)[0] || "";
    if (names.size > 1) return "";
    const projectKey = projectName.toLocaleLowerCase();
    return candidates
        .filter((candidate) => candidate.category === "prop")
        .map((candidate) => candidate.name.trim())
        .filter((name) => name && projectKey.includes(name.toLocaleLowerCase()))
        .sort((left, right) => right.length - left.length)[0] || "";
}

export function withPrimaryProductReferences(
    context: ShotAssetReferenceContext,
    detail: ProjectDetail,
    inputAssetRoles: Record<string, string> | undefined,
    productName: string,
    prompt: string,
): ShotAssetReferenceContext {
    if (!productName.trim() || !prompt.toLocaleLowerCase().includes(productName.toLocaleLowerCase())) return context;
    const productAssetIds = new Set(Object.entries(inputAssetRoles || {}).filter(([, role]) => role === "product").map(([assetId]) => assetId));
    if (!productAssetIds.size) return context;
    const mentionReferences = context.mentionReferences.map((reference) => reference.assetId && productAssetIds.has(reference.assetId)
        ? { ...reference, label: productName, title: productName, category: "prop" as const }
        : reference);
    const assetReferences = context.assetReferences.map((reference) => productAssetIds.has(reference.assetId)
        ? { ...reference, title: productName, category: "prop" }
        : reference);
    const seen = new Set(mentionReferences.flatMap((reference) => reference.assetId ? [reference.assetId] : []));
    const addedImages: ReferenceImage[] = [];
    const addedReferences: ShotPromptAssetReference[] = [];
    for (const asset of detail.assets) {
        if (!productAssetIds.has(asset.id) || seen.has(asset.id)) continue;
        const image = projectAssetReferenceImage(asset);
        if (!image) continue;
        seen.add(asset.id);
        addedImages.push(image);
        const imageIndex = mentionReferences.length + addedImages.length;
        mentionReferences.push({
            id: `project-asset:${asset.id}`,
            nodeId: "",
            assetId: asset.id,
            kind: "image",
            label: productName,
            title: productName,
            previewUrl: image.url,
            storageKey: image.storageKey,
            active: true,
            category: "prop",
        });
        addedReferences.push({ assetId: asset.id, title: productName, category: "prop", imageIndex });
    }
    return {
        mentionReferences,
        referenceImages: [...context.referenceImages, ...addedImages],
        referenceAudios: context.referenceAudios,
        assetReferences: [...assetReferences, ...addedReferences],
        resolvedCharacterVersions: context.resolvedCharacterVersions,
    };
}
export function resolveShotAssetMentionPrompt(prompt: string, context: ShotAssetReferenceContext, options: {
    dialogue?: string;
    imageIndexByAssetId?: ReadonlyMap<string, number>;
} = {}) {
    const normalizedPrompt = autoMentionShotAssetReferences(stripManagedShotAssetReferenceBlocks(prompt), context.mentionReferences);
    const imageLabelByAssetId = new Map(context.mentionReferences.map((reference, index) => {
        const imageIndex = reference.assetId ? options.imageIndexByAssetId?.get(reference.assetId) : undefined;
        return [reference.assetId, `图片${imageIndex ?? index + 1}`];
    }));
    const unresolved = new Set<string>();
    const resolved = normalizedPrompt.replace(/@\[asset:([^\]]+)\]/g, (token, assetId: string) => {
        const label = imageLabelByAssetId.get(assetId);
        if (!label) {
            unresolved.add(token);
            return token;
        }
        return label;
    });
    if (unresolved.size) throw new Error(`提示词中的 ${Array.from(unresolved).join("、")} 未绑定到当前镜头，请重新选择资产或删除引用`);
    const assetReferences = options.imageIndexByAssetId
        ? context.assetReferences.map((reference) => ({
            ...reference,
            imageIndex: options.imageIndexByAssetId?.get(reference.assetId) ?? reference.imageIndex,
        }))
        : context.assetReferences;
    const dialogueContext = withShotDialogue(assetReferences, options.dialogue);
    const assetBlock = compileShotAssetReferencePrompt(dialogueContext.references);
    const dialogueBlock = dialogueContext.unassignedDialogue ? `【镜头台词】\n\n${dialogueContext.unassignedDialogue}` : "";
    const referenceLock = context.referenceImages.length
        ? [
            "【参考图一致性】",
            "- 图片编号与资产名称一一对应，禁止互换人物身份或产品。",
            "- 保持参考图中的年龄、人物比例、服装、发型、产品结构、颜色、材质和标志；不得成年化、换脸、换装或改成另一种产品。",
            "- 未明确指定目标画风时，沿用参考图本身的视觉风格；文字中的“写实”不得覆盖参考图的童趣、3D 或插画风格。",
        ].join("\n")
        : "";
    return [resolved.trim(), referenceLock, assetBlock, dialogueBlock].filter(Boolean).join("\n\n");
}

/** Keep an explicit asset name glued to its own image token, so a later @ cannot drift to another character. */
export function autoMentionShotAssetReferences(
    prompt: string,
    references: Array<Pick<CanvasResourceReference, "assetId" | "kind" | "label" | "title">>,
) {
    let value = prompt;
    const grouped = new Map<string, { title: string; assetIds: string[] }>();
    references.forEach((reference) => {
        const title = (reference.title || reference.label).trim();
        if (!reference.assetId || !title) return;
        const key = `${reference.kind}:${title.toLocaleLowerCase()}`;
        const group = grouped.get(key) || { title, assetIds: [] };
        if (!group.assetIds.includes(reference.assetId)) group.assetIds.push(reference.assetId);
        grouped.set(key, group);
    });
    const candidates = Array.from(grouped.values()).sort((left, right) => right.title.length - left.title.length);

    for (const { assetIds, title } of candidates) {
        const compiledMention = new RegExp(`${escapeRegExp(title)}\\s+图片\\d+(?:、\\d+)*`, "u");
        if (compiledMention.test(value)) continue;
        const mentioned = new Set(Array.from(value.matchAll(/@\[asset:([^\]]+)\]/g), (match) => match[1]));
        const missing = assetIds.filter((assetId) => !mentioned.has(assetId));
        if (!missing.length) continue;
        const pattern = new RegExp(`@?${escapeRegExp(title)}`, "u");
        let replaced = false;
        value = value.replace(pattern, (match) => {
            if (replaced) return match;
            replaced = true;
            return `${title} ${missing.map((assetId) => `@[asset:${assetId}]`).join(" ")}`;
        });
    }
    return value;
}

export function ensureShotAssetMentionPrompt(prompt: string, references: Array<Pick<CanvasResourceReference, "assetId" | "kind" | "label" | "title">>) {
    const value = stripManagedShotAssetReferenceBlocks(prompt);
    if (!value) return "";
    const anchored = autoMentionShotAssetReferences(value, references);
    const mentionedAssetIds = new Set(Array.from(anchored.matchAll(/@\[asset:([^\]]+)\]/g), (match) => match[1]));
    const missing = references.filter((reference): reference is typeof reference & { assetId: string } => Boolean(reference.assetId && !mentionedAssetIds.has(reference.assetId)));
    if (!missing.length) return anchored;
    const groups = new Map<string, { title: string; assetIds: string[] }>();
    missing.forEach((reference) => {
        const title = (reference.title || reference.label).trim();
        const key = `${reference.kind}:${title.toLocaleLowerCase()}`;
        const group = groups.get(key) || { title, assetIds: [] };
        group.assetIds.push(reference.assetId);
        groups.set(key, group);
    });
    const lines = Array.from(groups.values()).map((group) => `- ${group.title}：${group.assetIds.map((assetId) => `@[asset:${assetId}]`).join(" ")}`);
    return `${anchored}\n\n【资产引用】\n${lines.join("\n")}`;
}

export function compileShotAssetReferencePrompt(references: ShotPromptAssetReference[]) {
    if (!references.length) return "";
    const groups = new Map<string, { title: string; category: string; imageIndices: number[]; audioIndices: number[]; voiceDescriptions: Set<string>; dialogues: Set<string> }>();
    for (const reference of references) {
        const key = `${reference.category}:${reference.title.trim().toLocaleLowerCase()}`;
        const group = groups.get(key) || {
            title: reference.title,
            category: reference.category,
            imageIndices: [],
            audioIndices: [],
            voiceDescriptions: new Set<string>(),
            dialogues: new Set<string>(),
        };
        if (!group.imageIndices.includes(reference.imageIndex)) group.imageIndices.push(reference.imageIndex);
        if (reference.audioIndex && !group.audioIndices.includes(reference.audioIndex)) group.audioIndices.push(reference.audioIndex);
        if (reference.voiceDescription?.trim()) group.voiceDescriptions.add(reference.voiceDescription.trim());
        if (reference.dialogue?.trim()) group.dialogues.add(reference.dialogue.trim());
        groups.set(key, group);
    }
    const lines = Array.from(groups.values()).flatMap((group) => {
        const visualLabel = group.category === "character" ? "人物参考" : `${projectAssetCategoryLabel(group.category)}参考`;
        const imageLabel = group.imageIndices.length > 1
            ? `图片${group.imageIndices.join("、")}（${group.category === "character" ? "同一角色多视图参考" : "多视图参考"}）`
            : `图片${group.imageIndices[0]}`;
        const media = [imageLabel, group.audioIndices.length ? `声音参考：音频${group.audioIndices.join("、")}` : ""].filter(Boolean).join("；");
        return [
            `- ${group.title}：${visualLabel}：${media}；只使用对应图片中的该${group.category === "character" ? "人物" : "产品/道具"}，不得替换为其他对象`,
            ...Array.from(group.voiceDescriptions, (voice) => `  声音画像：${voice}`),
            ...Array.from(group.dialogues, (dialogue) => `  镜头台词：${dialogue}`),
        ];
    });
    return ["【资产参考】", "", ...lines].join("\n");
}

function projectAssetReferenceImage(asset: ProjectAsset, reference?: ShotAssetReference): ReferenceImage | undefined {
    const boundRepresentations = reference?.referencedVersion?.representations || [];
    const representation = preferredVisualRepresentation(boundRepresentations)
        || (asset.character ? preferredVisualRepresentation(asset.character.representations) : undefined);
    if (representation) {
        return {
            id: asset.id,
            name: asset.title,
            type: "image/*",
            dataUrl: "",
            url: resourceFileUrl(representation.resourceId),
            storageKey: resourceStorageKey(representation.resourceId),
        };
    }
    if (asset.mediaType !== "image" || !asset.storageKey) return undefined;
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return {
        id: asset.id,
        name: asset.title,
        type: "image/*",
        dataUrl: "",
        ...(resourceId ? { url: resourceFileUrl(resourceId) } : {}),
        storageKey: asset.storageKey,
    };
}

function preferredVisualRepresentation(representations: CharacterRepresentation[]) {
    return representations.find((item) => item.role === "turnaround_sheet")
        || representations.find((item) => item.role === "primary")
        || representations.find((item) => item.role === "front")
        || representations.find((item) => item.mediaType.startsWith("image"));
}

function withShotDialogue(references: ShotPromptAssetReference[], dialogue?: string) {
    const value = stringValue(dialogue);
    if (!value) return { references, unassignedDialogue: "" };
    const characters = references.filter((reference) => reference.category === "character");
    if (characters.length === 1) {
        return {
            references: references.map((reference) => reference.assetId === characters[0]?.assetId ? { ...reference, dialogue: value } : reference),
            unassignedDialogue: "",
        };
    }
    const resolved = references.map((reference) => {
        if (reference.category !== "character") return reference;
        const matched = dialogueForCharacter(value, reference.title);
        return matched ? { ...reference, dialogue: matched } : reference;
    });
    return {
        references: resolved,
        unassignedDialogue: resolved.some((reference) => reference.dialogue) ? "" : value,
    };
}

function dialogueForCharacter(dialogue: string, characterName: string) {
    const escaped = characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[：:]\\s*([^\\n]+)`, "g");
    return Array.from(dialogue.matchAll(pattern), (match) => match[1]?.trim()).filter(Boolean).join("；");
}

function projectAssetCategory(value: string): AssetCategory {
    return normalizeAssetCategory(value);
}

function projectAssetCategoryLabel(value: string) {
    return assetCategoryLabel(value);
}

function characterVoiceDescription(asset: ProjectAsset) {
    const definition = asset.character?.definition || {};
    const voice = asset.character?.voice;
    return [
        stringValue(definition.voiceLanguage) || stringValue(voice?.profile.language),
        stringValue(definition.voiceAge),
        stringValue(definition.voiceTimbre) || stringValue(voice?.profile.timbre),
        stringValue(voice?.instructions),
    ].filter(Boolean).join("；");
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function meaningfulReferenceName(value: string | undefined) {
    const name = (value || "").trim();
    return ["", "产品", "道具", "场景", "资产", "人物", "角色", "生成图片", "图片", "未命名", "未命名图片"].includes(name.toLocaleLowerCase()) ? "" : name;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripManagedShotAssetReferenceBlocks(prompt: string) {
    const value = prompt.trim();
    if (!value) return "";
    const markerIndexes = managedShotAssetReferenceMarkers
        .map((marker) => value.indexOf(marker))
        .filter((index) => index >= 0);
    if (!markerIndexes.length) return value;
    return value.slice(0, Math.min(...markerIndexes)).trimEnd();
}
