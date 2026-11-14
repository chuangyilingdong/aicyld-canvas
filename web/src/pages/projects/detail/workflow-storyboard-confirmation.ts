import type { ProjectDetail, ProjectShot } from "@/services/api/projects";

export function smartFilmPromptGate(input: {
    detail: ProjectDetail;
    stage: string;
    shots: ProjectShot[];
    selectedShot?: ProjectShot;
    editorDirty: boolean;
}): string | undefined {
    if (input.stage !== "video" || !["smart-film", "smart-film-auto"].includes(input.detail.project.type)) return undefined;
    if (input.editorDirty) return "当前镜头有未保存修改，请先保存并重新确认分镜提示词";
    if (input.selectedShot && input.selectedShot.status !== "confirmed") return "请先确认当前镜头的分镜提示词，再生成视频";
    const unconfirmed = input.shots.filter((shot) => shot.status !== "confirmed").length;
    if (unconfirmed) return `还有 ${unconfirmed} 个镜头的分镜提示词未确认，请先确认全部提示词`;
    return undefined;
}

export async function saveConfirmedStoryboardPrompts<T>(input: {
    shots: ProjectShot[];
    selectedShotId?: string;
    selectedValues?: T;
    valuesForShot: (shot: ProjectShot, index: number) => T;
    save: (shot: ProjectShot, values: T) => Promise<void>;
}) {
    for (let index = 0; index < input.shots.length; index += 1) {
        const shot = input.shots[index];
        const values = shot.id === input.selectedShotId && input.selectedValues ? input.selectedValues : input.valuesForShot(shot, index);
        await input.save(shot, values);
    }
}

export async function confirmAutomaticSmartFilmPrompts<T>(input: {
    stage: string;
    projectType: string;
    shots: ProjectShot[];
    selectedShotId?: string;
    selectedValues: () => Promise<T | undefined>;
    valuesForShot: (shot: ProjectShot, index: number) => T;
    save: (shot: ProjectShot, values: T) => Promise<void>;
    onConfirmed: () => Promise<void>;
}) {
    if (input.stage !== "storyboard" || input.projectType !== "smart-film-auto" || !input.shots.length) return;
    if (input.shots.every((shot) => shot.status === "confirmed")) return;
    const selectedValues = input.selectedShotId ? await input.selectedValues() : undefined;
    await saveConfirmedStoryboardPrompts({
        shots: input.shots,
        selectedShotId: input.selectedShotId,
        selectedValues,
        valuesForShot: input.valuesForShot,
        save: input.save,
    });
    await input.onConfirmed();
}
