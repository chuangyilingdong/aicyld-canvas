import type { ProjectShot, ShotAssetRole, ShotRevision, ShotRevisionInput } from "@/services/api/projects";
import type { SmartFilmProductionRun, SmartFilmScript } from "@/services/api/smart-film-batches";

export type SmartFilmBulkDialogKind = "title" | "creative" | "regenerate" | "delete" | "confirm_assets" | "confirm_storyboard";

export type SmartFilmBulkEligibility = {
    title: number;
    creative: number;
    regenerate: number;
    delete: number;
    confirmAssets: number;
    confirmStoryboard: number;
};

export const smartFilmCreativeRequirementMarker = "【统一创意要求】";

export function batchBulkEligibility(scripts: SmartFilmScript[], runsByScript: Map<string, SmartFilmProductionRun>): SmartFilmBulkEligibility {
    return scripts.reduce<SmartFilmBulkEligibility>((counts, script) => {
        counts.title += 1;
        counts.creative += 1;
        if (!script.projectId) {
            counts.regenerate += 1;
            counts.delete += 1;
            return counts;
        }
        const run = runsByScript.get(script.id);
        if (run?.assetStatus === "ready") counts.confirmAssets += 1;
        if (script.status === "storyboard_ready" && run?.storyboardStatus === "ready") counts.confirmStoryboard += 1;
        return counts;
    }, { title: 0, creative: 0, regenerate: 0, delete: 0, confirmAssets: 0, confirmStoryboard: 0 });
}

export function bulkDialogCount(kind: SmartFilmBulkDialogKind | "", eligibility: SmartFilmBulkEligibility) {
    switch (kind) {
        case "title": return eligibility.title;
        case "creative": return eligibility.creative;
        case "regenerate": return eligibility.regenerate;
        case "delete": return eligibility.delete;
        case "confirm_assets": return eligibility.confirmAssets;
        case "confirm_storyboard": return eligibility.confirmStoryboard;
        default: return 0;
    }
}

export function smartFilmBulkTitle(template: string, index: number, total: number, appendIndex: boolean) {
    const base = template.trim();
    if (!base) return "";
    const width = Math.max(2, String(Math.max(total, 1)).length);
    const ordinal = String(index + 1).padStart(width, "0");
    if (base.includes("{n}")) return base.replaceAll("{n}", ordinal).trim();
    return appendIndex && total > 1 ? `${base} ${ordinal}` : base;
}

export function applySmartFilmCreativeRequirement(content: string, requirement: string) {
    const nextRequirement = requirement.trim();
    if (!nextRequirement) return content;
    const markerIndex = content.indexOf(smartFilmCreativeRequirementMarker);
    const base = (markerIndex >= 0 ? content.slice(0, markerIndex) : content).trimEnd();
    return `${base}\n\n${smartFilmCreativeRequirementMarker}\n${nextRequirement}`;
}

export function shotConfirmationInput(shot: ProjectShot, revision: ShotRevision): ShotRevisionInput {
    const actionBeats = parseJSONArray<Record<string, unknown>>(revision.actionBeatsJson);
    const assetRoles = parseJSONArray<ShotAssetRole>(revision.assetRolesJson);
    return {
        plotDescription: revision.plotDescription || shot.description,
        action: revision.action,
        dialogue: revision.dialogue,
        shotSize: revision.shotSize,
        cameraAngle: revision.cameraAngle,
        cameraMovement: revision.cameraMovement,
        durationMs: revision.durationMs || shot.durationMs,
        imagePrompt: revision.imagePrompt,
        videoPrompt: revision.videoPrompt,
        negativePrompt: revision.negativePrompt,
        continuityNotes: revision.continuityNotes,
        ...(actionBeats ? { actionBeats } : {}),
        ...(assetRoles ? { assetRoles } : {}),
    };
}

function parseJSONArray<T>(value?: string): T[] | undefined {
    if (!value) return undefined;
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed as T[] : undefined;
    } catch {
        return undefined;
    }
}
