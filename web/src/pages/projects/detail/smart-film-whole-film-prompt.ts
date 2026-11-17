import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";
import { resourceFileUrl } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

import { buildShotAssetReferenceContext, resolveShotAssetMentionPrompt, stripUnboundShotAssetMentions } from "./workflow-shot-references";
import { currentRevision } from "./workflow-shared";

type StoryboardEntry = {
    shot: ProjectShot;
    artifact: ShotArtifact;
};

export function buildSmartFilmWholeFilmPrompt(detail: ProjectDetail, entries: StoryboardEntry[], targetSeconds: number) {
    const referenceImages: ReferenceImage[] = [];
    const imageIndexByStorageKey = new Map<string, number>();
    const imageIndexByAssetId = new Map<string, number>();

    const addImage = (image: ReferenceImage) => {
        const key = image.storageKey || image.url || image.id;
        const existing = imageIndexByStorageKey.get(key);
        if (existing) return existing;
        referenceImages.push(image);
        const index = referenceImages.length;
        imageIndexByStorageKey.set(key, index);
        return index;
    };

    const shotPlans = entries.map(({ shot, artifact }, shotIndex) => {
        const storyboardStorageKey = `resource:${artifact.resourceId}`;
        const storyboardImageIndex = addImage({
            id: `smart-film-storyboard-${shotIndex}`,
            name: `分镜 ${shotIndex + 1} · ${shot.title}`,
            type: "image/*",
            dataUrl: "",
            url: resourceFileUrl(artifact.resourceId!),
            storageKey: storyboardStorageKey,
        });
        const context = buildShotAssetReferenceContext(detail, shot.id);
        context.referenceImages.forEach((image, assetIndex) => {
            const assetId = context.assetReferences[assetIndex]?.assetId;
            const imageIndex = addImage(image);
            if (assetId) imageIndexByAssetId.set(assetId, imageIndex);
        });
        return { shot, storyboardImageIndex, context };
    });

    const shotPrompts = shotPlans.map(({ shot, storyboardImageIndex, context }, index) => {
        const revision = currentRevision(detail, shot);
        const motion = [
            stripUnboundShotAssetMentions(revision?.videoPrompt || revision?.plotDescription || shot.description || shot.title, context),
            stripUnboundShotAssetMentions(revision?.action || "", context),
        ].filter(Boolean).join("\n");
        const resolved = resolveShotAssetMentionPrompt(motion, context, {
            dialogue: revision?.dialogue,
            imageIndexByAssetId,
        });
        const seconds = Math.max(0.5, shot.durationMs / 1000);
        return `第 ${index + 1} 镜（计划 ${seconds} 秒，使用第 ${storyboardImageIndex} 张分镜图）：\n${resolved}`;
    });

    return {
        prompt: `把以下已确认分镜图按顺序生成一个完整的 ${targetSeconds} 秒视频。保持角色、产品、场景和画风一致，镜头之间自然衔接。\n${shotPrompts.join("\n\n")}`,
        referenceImages,
        storyboardResourceIds: entries.map(({ artifact }) => artifact.resourceId!),
    };
}
