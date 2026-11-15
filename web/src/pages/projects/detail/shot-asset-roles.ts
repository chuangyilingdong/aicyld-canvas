import { assetCategoryLabel } from "@/lib/asset-category";
import type { ProjectAsset, ShotAssetReference, ShotAssetRole } from "@/services/api/projects";

export function parseShotAssetRoles(value?: string): ShotAssetRole[] {
    if (!value?.trim()) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.flatMap((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return [];
            const record = item as Record<string, unknown>;
            const assetId = typeof record.assetId === "string" ? record.assetId.trim() : "";
            const role = typeof record.role === "string" ? record.role.trim() : "";
            if (!assetId || !role) return [];
            return [{
                assetId,
                role,
                ...(typeof record.versionId === "string" && record.versionId.trim() ? { versionId: record.versionId.trim() } : {}),
                ...(typeof record.title === "string" && record.title.trim() ? { title: record.title.trim() } : {}),
            }];
        });
    } catch {
        return [];
    }
}

export function linkedShotAssetReferences(references: ShotAssetReference[]) {
    return references.filter((reference) => reference.role === "reference" && reference.status === "linked");
}

export function activeShotAssetRoles(roles: ShotAssetRole[], references: ShotAssetReference[], assets: ProjectAsset[]) {
    const linked = linkedShotAssetReferences(references);
    const assetByVersionId = new Map(assets.filter((asset) => asset.primaryVersionId).map((asset) => [asset.primaryVersionId as string, asset]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const linkedAssetIds = new Set(linked.flatMap((reference) => {
        const asset = reference.asset || assetByVersionId.get(reference.assetVersionId);
        return asset ? [asset.id] : [];
    }));
    return roles.flatMap((role) => {
        if (!linkedAssetIds.has(role.assetId)) return [];
        const asset = assetById.get(role.assetId);
        return [{ ...role, versionId: asset?.primaryVersionId || role.versionId, title: asset?.title || role.title }];
    });
}

export function shotAssetRoleLabel(role: string | undefined, category: unknown) {
    switch (role?.trim().toLowerCase()) {
        case "product": return "产品";
        case "character": return "人物";
        case "scene":
        case "environment": return "场景";
        case "prop": return "道具";
        case "other": return "其他";
        default: return assetCategoryLabel(category);
    }
}
