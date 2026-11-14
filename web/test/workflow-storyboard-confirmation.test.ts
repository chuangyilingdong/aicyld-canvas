import { expect, test } from "bun:test";

import type { ProjectShot } from "../src/services/api/projects";
import { confirmAutomaticSmartFilmPrompts, smartFilmPromptGate } from "../src/pages/projects/detail/workflow-storyboard-confirmation";

const draftShot = { id: "shot-1", status: "draft" } as ProjectShot;
const confirmedShot = { id: "shot-1", status: "confirmed" } as ProjectShot;

test("smart-film-auto saves confirmed prompts before entering video generation", async () => {
    const saved: string[] = [];
    await confirmAutomaticSmartFilmPrompts({
        stage: "storyboard",
        projectType: "smart-film-auto",
        shots: [draftShot],
        selectedShotId: undefined,
        selectedValues: async () => undefined,
        valuesForShot: () => "prompt",
        save: async (shot) => { saved.push(shot.id); },
        onConfirmed: async () => undefined,
    });
    expect(saved).toEqual(["shot-1"]);
});

test("video prompt gate applies to both smart-film project types", () => {
    for (const projectType of ["smart-film", "smart-film-auto"]) {
        const gate = smartFilmPromptGate({
            detail: { project: { type: projectType } } as never,
            stage: "video",
            shots: [draftShot],
            selectedShot: draftShot,
            editorDirty: false,
        });
        expect(gate).toContain("确认");
    }
    expect(smartFilmPromptGate({
        detail: { project: { type: "smart-film-auto" } } as never,
        stage: "video",
        shots: [confirmedShot],
        selectedShot: confirmedShot,
        editorDirty: false,
    })).toBeUndefined();
});
