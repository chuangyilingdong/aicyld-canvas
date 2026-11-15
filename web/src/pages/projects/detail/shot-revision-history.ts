import type { ProjectShot, ShotRevision } from "@/services/api/projects";
import type { ShotEditorValues } from "./workflow-production-helpers";
import { parseShotAssetRoles } from "./shot-asset-roles";

export type ShotRevisionDiffField = {
    key: string;
    label: string;
    current: string;
    selected: string;
    changed: boolean;
};

export function shotEditorValuesFromRevision(shot: ProjectShot, revision: ShotRevision): ShotEditorValues {
    return { title: shot.title, ...shotEditorValuesFromRevisionFields(revision) };
}

export function shotRevisionInputFromRevision(revision: ShotRevision) {
    return shotEditorValuesFromRevisionFields(revision);
}

function shotEditorValuesFromRevisionFields(revision: ShotRevision): Omit<ShotEditorValues, "title"> {
    return {
        plotDescription: revision.plotDescription,
        action: revision.action,
        dialogue: revision.dialogue,
        shotSize: revision.shotSize,
        cameraAngle: revision.cameraAngle,
        cameraMovement: revision.cameraMovement,
        durationSeconds: revision.durationMs / 1000,
        imagePrompt: revision.imagePrompt,
        videoPrompt: revision.videoPrompt,
        negativePrompt: revision.negativePrompt,
        continuityNotes: revision.continuityNotes,
        actionBeats: parseActionBeats(revision.actionBeatsJson),
        assetRoles: parseShotAssetRoles(revision.assetRolesJson),
    };
}

export function compareShotRevisions(current: ShotRevision | undefined, selected: ShotRevision): ShotRevisionDiffField[] {
    const currentValues = current ? shotRevisionInputFromRevision(current) : undefined;
    const selectedValues = shotRevisionInputFromRevision(selected);
    return [
        field("plotDescription", "镜头画面", currentValues?.plotDescription, selectedValues.plotDescription),
        field("action", "动作", currentValues?.action, selectedValues.action),
        field("dialogue", "台词/旁白", currentValues?.dialogue, selectedValues.dialogue),
        field("shotSize", "景别", currentValues?.shotSize, selectedValues.shotSize),
        field("cameraAngle", "机位", currentValues?.cameraAngle, selectedValues.cameraAngle),
        field("cameraMovement", "运镜", currentValues?.cameraMovement, selectedValues.cameraMovement),
        field("durationSeconds", "时长", currentValues ? `${currentValues.durationSeconds}s` : "", `${selectedValues.durationSeconds}s`),
        field("imagePrompt", "画面提示词", currentValues?.imagePrompt, selectedValues.imagePrompt),
        field("videoPrompt", "视频提示词", currentValues?.videoPrompt, selectedValues.videoPrompt),
        field("negativePrompt", "负面提示词", currentValues?.negativePrompt, selectedValues.negativePrompt),
        field("continuityNotes", "连续性备注", currentValues?.continuityNotes, selectedValues.continuityNotes),
    ];
}

function field(key: string, label: string, current: string | undefined, selected: string | undefined) {
    const currentValue = current || "";
    return { key, label, current: currentValue, selected: selected || "", changed: currentValue !== (selected || "") };
}

function parseActionBeats(value?: string): Array<Record<string, unknown>> | undefined {
    if (!value?.trim()) return undefined;
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : undefined;
    } catch {
        return undefined;
    }
}
