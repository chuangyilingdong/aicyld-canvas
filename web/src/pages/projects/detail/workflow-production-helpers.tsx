import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { Box, ChevronDown, ChevronLeft, ChevronRight, Image as ImageIcon, Search, Sparkles, UsersRound } from "lucide-react";

import { EmptyState } from "@/components/ui/product/empty-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isMusicAudioModel } from "@/lib/audio-generation";
import { canvasFeatureModel } from "@/lib/canvas/feature-models";
import { resolveCompatibleModel, resolveModelVideoBooleanOptions, type ModelRequirements } from "@/lib/model-selection";
import { normalizeDefaultShotTitle } from "@/lib/shot-label";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { listProjectAssetsPage, type ProjectAsset, type ProjectAssetCandidate, type ProjectDetail, type ProjectShot, type ShotAssetReference, type ShotArtifact, type ShotRevisionInput } from "@/services/api/projects";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";
import { ensureShotAssetMentionPrompt, buildShotAssetReferenceContext, type ShotAssetReferenceContext } from "./workflow-shot-references";
import { assetCategoryLabel, currentArtifact, currentRevision } from "./workflow-shared";

export type ShotEditorValues = Omit<ShotRevisionInput, "durationMs"> & {
    title: string;
    durationSeconds: number;
};

export function formatTaskElapsed(startedAt: number, now: number) {
    const totalSeconds = Math.max(0, Math.floor((now - (Number.isFinite(startedAt) ? startedAt : now)) / 1_000));
    return `${Math.floor(totalSeconds / 60)}分钟${String(totalSeconds % 60).padStart(2, "0")}秒`;
}

export function WorkflowDisclosure({ icon, title, description, summary, className = "", children }: { icon: ReactNode; title: string; description: string; summary: ReactNode; className?: string; children: ReactNode }) {
    return (
        <details className={`workflow-disclosure ${className}`}>
            <summary>
                <span className="workflow-disclosure-heading"><span className="workflow-disclosure-icon">{icon}</span><span><strong>{title}</strong><small>{description}</small></span></span>
                <span className="workflow-disclosure-summary">{summary}<ChevronDown className="workflow-disclosure-chevron" /></span>
            </summary>
            <div className="workflow-disclosure-body"><div className="workflow-disclosure-content">{children}</div></div>
        </details>
    );
}

export function AssetLibrary({ detail, unitId, referenceByVersionId, changing, onToggle, onUseCandidate, confirmingCandidateId }: {
    detail: ProjectDetail;
    unitId: string;
    referenceByVersionId: Map<string, ShotAssetReference>;
    changing: boolean;
    onToggle: (asset: ProjectAsset, reference?: ShotAssetReference) => void;
    onUseCandidate: (candidate: ProjectAssetCandidate) => void;
    confirmingCandidateId?: string;
}) {
    const [category, setCategory] = useState("all");
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    const [page, setPage] = useState(1);
    const pageSize = 30;
    const assetsQuery = useQuery({
        queryKey: ["project", detail.project.id, "assets", "workflow-library", category, debouncedKeyword, page, pageSize],
        queryFn: () => listProjectAssetsPage(detail.project.id, { page, pageSize, category: category === "all" ? undefined : category, query: debouncedKeyword || undefined }),
    });
    useEffect(() => setPage(1), [debouncedKeyword]);
    const assetsPage = assetsQuery.data?.assets || [];
    const groups = useMemo(() => {
        const map = new Map<string, ProjectAsset[]>();
        assetsPage.forEach((asset) => map.set(asset.category || "other", [...(map.get(asset.category || "other") || []), asset]));
        return Array.from(map.entries());
    }, [assetsPage]);
    const total = assetsQuery.data?.total || 0;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const candidates = useMemo(() => {
        const query = debouncedKeyword.toLowerCase();
        return detail.assetCandidates.filter((candidate) =>
            candidate.status === "pending_confirmation"
            && (!candidate.unitId || candidate.unitId === unitId)
            && (category === "all" || candidate.category === category)
            && (!query || candidate.name.toLowerCase().includes(query))
        );
    }, [category, debouncedKeyword, detail.assetCandidates, unitId]);
    return (
        <div className="workflow-asset-groups">
            <Input allowClear size="small" className="mb-2 w-full" value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<Search className="size-3.5 text-foreground/35" />} placeholder="搜索资产名称" aria-label="搜索镜头资产" />
            <Select size="small" className="mb-2 w-full" value={category} options={[{ value: "all", label: `全部资产（${Object.values(assetsQuery.data?.categoryCounts || {}).reduce((sum, count) => sum + count, 0) + candidates.length}）` }, ...Object.entries(assetsQuery.data?.categoryCounts || {}).filter(([, count]) => count > 0).map(([value, count]) => ({ value, label: `${assetCategoryLabel(value)}（${count}）` })), ...ASSET_CATEGORIES.filter((value) => !Object.keys(assetsQuery.data?.categoryCounts || {}).includes(value) && candidates.some((candidate) => candidate.category === value)).map((value) => ({ value, label: `${ASSET_CATEGORY_LABELS[value]}（${candidates.filter((candidate) => candidate.category === value).length}）` }))]} onChange={(value) => { setCategory(value); setPage(1); }} />
            {candidates.length ? (
                <section className="mb-3">
                    <h3>待确认资产 <span>({candidates.length})</span></h3>
                    <div className="workflow-asset-list">
                        {candidates.map((candidate) => (
                            <div key={candidate.id} className="workflow-asset-row is-candidate">
                                <span className="workflow-asset-thumb"><Sparkles className="size-4" /></span>
                                <span className="min-w-0 flex-1"><strong>{candidate.name}</strong><small>{assetCategoryLabel(candidate.category)} · {assetCandidateDescription(candidate)}</small></span>
                                <Button type="link" size="small" loading={confirmingCandidateId === candidate.id} disabled={changing} onClick={() => onUseCandidate(candidate)}>确认并使用</Button>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
            {assetsQuery.isLoading ? <div className="py-6 text-center text-xs text-foreground/45">正在读取资产…</div> : groups.length ? groups.map(([groupCategory, assets]) => (
                <section key={groupCategory}>
                    <h3>{assetCategoryLabel(groupCategory)} <span>({assets.length})</span></h3>
                    <div className="workflow-asset-list">
                        {assets.map((asset) => {
                            const reference = asset.primaryVersionId ? referenceByVersionId.get(asset.primaryVersionId) : undefined;
                            const active = Boolean(reference);
                            const previewUrl = assetPreviewUrl(asset);
                            return <button key={asset.id} type="button" className={`workflow-asset-row ${active ? "is-active" : ""}`} disabled={changing || !asset.primaryVersionId} aria-pressed={active} onClick={() => onToggle(asset, reference)}><span className="workflow-asset-thumb">{previewUrl ? <img src={previewUrl} alt="" loading="lazy" /> : asset.category === "character" ? <UsersRound /> : asset.mediaType === "image" ? <ImageIcon /> : <Box />}</span><span className="min-w-0 flex-1"><strong>{asset.title}</strong><small>{active ? "已绑定 · 点击取消" : `${assetCategoryLabel(asset.category)} · v${Math.max(1, asset.versionCount)}`}</small></span>{active ? <span className="workflow-bound-dot" /> : null}</button>;
                        })}
                    </div>
                </section>
            )) : candidates.length ? null : <EmptyState size="compact" title={debouncedKeyword ? "没有找到匹配资产" : "项目还没有资产"} />}
            {total > pageSize ? <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-[var(--fs-micro)] text-foreground/45"><span>{page}/{pages} · 共 {total} 项</span><span className="flex gap-1"><Button type="text" size="small" icon={<ChevronLeft className="size-3.5" />} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} /><Button type="text" size="small" icon={<ChevronRight className="size-3.5" />} disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} /></span></div> : null}
        </div>
    );
}

function assetCandidateDescription(candidate: ProjectAssetCandidate) {
    try {
        const details = JSON.parse(candidate.detailsJson || "{}") as Record<string, unknown>;
        const value = details.prompt || details.description || details.appearance || details.consistencyPrompt;
        return typeof value === "string" && value.trim() ? value.trim().slice(0, 34) : "待确认";
    } catch {
        return "待确认";
    }
}

export function revisionInput(values: ShotEditorValues): ShotRevisionInput {
    return {
        plotDescription: values.plotDescription,
        action: values.action,
        dialogue: values.dialogue,
        shotSize: values.shotSize,
        cameraAngle: values.cameraAngle,
        cameraMovement: values.cameraMovement,
        durationMs: Math.round(values.durationSeconds * 1000),
        imagePrompt: values.imagePrompt,
        videoPrompt: values.videoPrompt,
        negativePrompt: values.negativePrompt,
        continuityNotes: values.continuityNotes,
    };
}

export function latestShotTask(detail: ProjectDetail, shotId: string, artifactType: string) {
    return (detail.tasks || [])
        .filter((task) => task.clientContext?.shotId === shotId && task.clientContext?.artifactType === artifactType)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function shotNeedsGeneration(detail: ProjectDetail, shot: ProjectShot, artifactType: string) {
    const task = latestShotTask(detail, shot.id, artifactType);
    if (task?.status === "queued" || task?.status === "running") return false;
    const artifact = currentArtifact(detail, shot.id, artifactType);
    if (artifact?.status === "pending" || artifact?.status === "running") return false;
    return !artifact || !artifact.resourceId || artifact.status === "failed" || artifact.status === "stale";
}

export function runningStageTasks(detail: ProjectDetail, shots: ProjectShot[], artifactType: string) {
    return shots.flatMap((shot) => {
        const task = latestShotTask(detail, shot.id, artifactType);
        return task?.status === "queued" || task?.status === "running" ? [task] : [];
    });
}

export function resolveNarrationAudioModel(config: AiConfig) {
    const preferred = canvasFeatureModel("audio.tts") || config.audioModel;
    if (preferred && !isMusicAudioModel(preferred)) return preferred;
    return (config.audioModels || []).find((model) => !isMusicAudioModel(model)) || "";
}

export function resolveMusicAudioModel(config: AiConfig) {
    const preferred = canvasFeatureModel("audio.music");
    if (preferred) return preferred;
    if (config.audioModel && isMusicAudioModel(config.audioModel)) return config.audioModel;
    return (config.audioModels || []).find(isMusicAudioModel) || "";
}

export function audioArtifactPurpose(artifact: ShotArtifact) {
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

export function currentBgmArtifact(detail: ProjectDetail, unitId: string) {
    const artifacts = (detail.shotArtifacts || [])
        .filter((item) => item.unitId === unitId && item.type === "audio" && audioArtifactPurpose(item) === "music")
        .slice()
        .sort((left, right) => right.version - left.version);
    return artifacts.find((item) => item.selected) || artifacts[0];
}

export function shotEditorValues(detail: ProjectDetail, shot: ProjectShot, index: number, context: ReturnType<typeof buildShotAssetReferenceContext>): ShotEditorValues {
    const shotRevision = currentRevision(detail, shot);
    return {
        title: normalizeDefaultShotTitle(shot.title, index),
        plotDescription: shotRevision?.plotDescription || shot.description || "",
        action: shotRevision?.action || "",
        dialogue: shotRevision?.dialogue || "",
        shotSize: shotRevision?.shotSize || "",
        cameraAngle: shotRevision?.cameraAngle || "",
        cameraMovement: shotRevision?.cameraMovement || "",
        durationSeconds: Math.max(0.5, (shotRevision?.durationMs || shot.durationMs || 3000) / 1000),
        imagePrompt: shotRevision?.imagePrompt || "",
        videoPrompt: ensureShotAssetMentionPrompt(shotRevision?.videoPrompt || "", context.mentionReferences),
        negativePrompt: shotRevision?.negativePrompt || "",
        continuityNotes: shotRevision?.continuityNotes || "",
    };
}

export function withStoryboardVideoReference(detail: ProjectDetail, shot: ProjectShot, context: ShotAssetReferenceContext): ShotAssetReferenceContext {
    const storyboard = currentArtifact(detail, shot.id, "storyboard");
    if (!storyboard?.resourceId || storyboard.status !== "ready") return context;
    const storageKey = `resource:${storyboard.resourceId}`;
    if (context.referenceImages.some((image) => image.storageKey === storageKey)) return context;
    return {
        ...context,
        referenceImages: [
            ...context.referenceImages,
            {
                id: `storyboard:${shot.id}`,
                name: "当前镜头分镜参考",
                type: "image/*",
                dataUrl: "",
                url: resourceFileUrl(storyboard.resourceId),
                storageKey,
            },
        ],
    };
}

export function modelRequirementsForShot(
    capability: "image" | "video",
    context: ReturnType<typeof buildShotAssetReferenceContext>,
    values: ShotEditorValues,
    aspectRatio: string,
    resolution: string,
    imageQuality: string,
) {
    const seconds = String(Math.max(1, Math.round(values.durationSeconds)));
    const referenceAudios = capability === "video" ? context.referenceAudios : [];
    const videoOperation = capability === "video" && context.referenceImages.length ? "reference_to_video" : undefined;
    return {
        capability,
        input: { textCount: 1, imageCount: context.referenceImages.length, videoCount: 0, audioCount: referenceAudios.length, characterCount: 0 },
        videoOperation,
        videoSeconds: capability === "video" ? seconds : undefined,
        imageSize: capability === "image" ? aspectRatio : undefined,
        options: capability === "video"
            ? { size: aspectRatio, vquality: resolution, videoSeconds: Number(seconds) }
            : { size: aspectRatio, quality: imageQuality },
    } satisfies ModelRequirements;
}

export function generationConfigForShot(input: {
    effectiveConfig: AiConfig;
    capability: "image" | "video";
    requestedModel: string;
    context: ReturnType<typeof buildShotAssetReferenceContext>;
    values: ShotEditorValues;
    aspectRatio: string;
    resolution: string;
    imageQuality: string;
}) {
    const requirements = modelRequirementsForShot(input.capability, input.context, input.values, input.aspectRatio, input.resolution, input.imageQuality);
    const model = resolveCompatibleModel(input.effectiveConfig, input.requestedModel, requirements) || input.requestedModel;
    const videoBooleanOptions = input.capability === "video"
        ? resolveModelVideoBooleanOptions(input.effectiveConfig, model, {}, {
              videoGenerateAudio: input.effectiveConfig.videoGenerateAudio,
              videoWatermark: input.effectiveConfig.videoWatermark,
          })
        : undefined;
    return {
        model,
        config: {
            ...input.effectiveConfig,
            model,
            imageModel: input.capability === "image" ? model : input.effectiveConfig.imageModel,
            videoModel: input.capability === "video" ? model : input.effectiveConfig.videoModel,
            size: input.aspectRatio,
            quality: input.imageQuality,
            vquality: input.resolution,
            videoSeconds: String(Math.max(1, Math.round(input.values.durationSeconds))),
            ...(videoBooleanOptions || {}),
        } satisfies AiConfig,
    };
}

export async function downloadArtifact(artifact: ShotArtifact, shotTitle: string, onError: (content: string) => void) {
    if (!artifact.resourceId) return;
    try {
        const response = await fetch(resourceFileUrl(artifact.resourceId), { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${shotTitle || "shot"}-v${artifact.version}.${artifact.type === "video" ? "mp4" : "png"}`;
        anchor.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        onError(error instanceof Error ? `下载失败：${error.message}` : "下载失败");
    }
}

export function assetPreviewUrl(asset: ProjectAsset) {
    const representation = asset.character?.representations?.find((item) => item.role === "primary") || asset.character?.representations?.[0];
    if (representation?.resourceId) return resourceFileUrl(representation.resourceId);
    const resourceId = resourceIdFromStorageKey(asset.storageKey);
    return resourceId && asset.mediaType === "image" ? resourceFileUrl(resourceId) : "";
}
