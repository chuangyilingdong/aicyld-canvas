import type { ProjectDetail, ProjectShot, ShotAssetReference } from "@/services/api/projects";
import { isProjectAssetVisualReference } from "./shot-asset-roles";
import { currentRevision } from "./workflow-shared";

export type ShotAssetConsistencyIssue = {
    shotId: string;
    shotTitle: string;
    severity: "error" | "warning";
    code: "missing_revision" | "no_visual_assets" | "missing_asset" | "text_only_asset" | "stale_asset_version" | "missing_asset_image" | "unbound_token";
    message: string;
    assetId?: string;
};

export function checkShotAssetConsistency(detail: ProjectDetail, shots: ProjectShot[]): ShotAssetConsistencyIssue[] {
    const issues: ShotAssetConsistencyIssue[] = [];
    const assetsById = new Map((detail.assets || []).map((asset) => [asset.id, asset]));
    for (const shot of shots) {
        const revision = currentRevision(detail, shot);
        if (!revision) {
            issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "error", code: "missing_revision", message: "镜头没有当前脚本版本，无法校验资产引用" });
            continue;
        }
        const references = (detail.shotReferences || []).filter((reference) => reference.shotId === shot.id && reference.role === "reference" && reference.status === "linked");
        if (!references.length) {
            issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "warning", code: "no_visual_assets", message: "当前镜头还没有绑定视觉资产；如果画面需要固定产品、人物或场景，请先绑定资产" });
        }
        const linkedAssetIds = new Set<string>();
        for (const reference of references) {
            const asset = resolveReferenceAsset(reference, assetsById);
            if (!asset) {
                issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "error", code: "missing_asset", message: "镜头引用的资产已不存在或已移出项目" });
                continue;
            }
            linkedAssetIds.add(asset.id);
            if (!isProjectAssetVisualReference(asset)) {
                issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "error", code: "text_only_asset", message: `资产“${asset.title}”是文本设定，没有可用于生图的资产图`, assetId: asset.id });
            }
            if (asset.primaryVersionId && reference.assetVersionId !== asset.primaryVersionId) {
                issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "error", code: "stale_asset_version", message: `资产“${asset.title}”已有新版本，当前镜头仍引用旧版本`, assetId: asset.id });
            }
            if (asset.mediaType === "image" && !asset.storageKey) {
                issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "error", code: "missing_asset_image", message: `资产“${asset.title}”缺少可用的资产图资源`, assetId: asset.id });
            }
        }
        for (const assetId of assetMentionIds(`${revision.imagePrompt}\n${revision.videoPrompt}`)) {
            if (!linkedAssetIds.has(assetId)) {
                issues.push({ shotId: shot.id, shotTitle: shot.title, severity: "error", code: "unbound_token", message: `提示词引用了未绑定资产 ${assetId}`, assetId });
            }
        }
    }
    return dedupeIssues(issues).sort((left, right) => Number(right.severity === "error") - Number(left.severity === "error"));
}

export function assetMentionIds(prompt: string) {
    return Array.from(prompt.matchAll(/@\[asset:([^\]]+)\]/g), (match) => match[1]?.trim() || "").filter(Boolean);
}

function resolveReferenceAsset(reference: ShotAssetReference, assetsById: Map<string, ProjectDetail["assets"][number]>) {
    if (reference.asset) return reference.asset;
    return Array.from(assetsById.values()).find((asset) => asset.primaryVersionId === reference.assetVersionId);
}

function dedupeIssues(issues: ShotAssetConsistencyIssue[]) {
    const seen = new Set<string>();
    return issues.filter((issue) => {
        const key = `${issue.shotId}:${issue.code}:${issue.assetId || ""}:${issue.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
