import { expect, test } from "bun:test";

import type { ProjectShot } from "../src/services/api/projects";
import { smartFilmPromptGate } from "../src/pages/projects/detail/workflow-storyboard-confirmation";

const draftShot = { id: "shot-1", status: "draft" } as ProjectShot;
const confirmedShot = { id: "shot-1", status: "confirmed" } as ProjectShot;

test("video prompt gate applies to multi-script film projects", () => {
    const gate = smartFilmPromptGate({
        detail: { project: { type: "smart-film" } } as never,
        stage: "video",
        shots: [draftShot],
        selectedShot: draftShot,
        editorDirty: false,
    });
    expect(gate).toContain("确认");
    expect(smartFilmPromptGate({
        detail: { project: { type: "smart-film" } } as never,
        stage: "video",
        shots: [confirmedShot],
        selectedShot: confirmedShot,
        editorDirty: false,
    })).toBeUndefined();
});
