import { describe, expect, test } from "bun:test";

import type { ProjectShot, ShotRevision } from "../src/services/api/projects";
import { compareShotRevisions, shotEditorValuesFromRevision } from "../src/pages/projects/detail/shot-revision-history";

const shot = { id: "shot-1", projectId: "project-1", title: "镜头 1", description: "", position: 0, durationMs: 5000, status: "draft", createdAt: "", updatedAt: "" } satisfies ProjectShot;

function revision(overrides: Partial<ShotRevision>): ShotRevision {
    return {
        id: "revision-current",
        shotId: shot.id,
        version: 2,
        plotDescription: "当前镜头画面",
        action: "人物向右走",
        dialogue: "",
        shotSize: "中景",
        cameraAngle: "平视",
        cameraMovement: "推进",
        durationMs: 5000,
        imagePrompt: "当前画面提示词",
        videoPrompt: "当前视频提示词",
        negativePrompt: "模糊",
        continuityNotes: "保持衣服一致",
        actionBeatsJson: JSON.stringify([{ start: 0, action: "抬头" }]),
        assetRolesJson: JSON.stringify([{ assetId: "asset-1", role: "product", title: "咖啡杯" }]),
        createdAt: "",
        ...overrides,
    };
}

describe("shot revision history", () => {
    test("restores editable values and parses action beats and asset roles", () => {
        const values = shotEditorValuesFromRevision(shot, revision({}));
        expect(values.durationSeconds).toBe(5);
        expect(values.actionBeats).toEqual([{ start: 0, action: "抬头" }]);
        expect(values.assetRoles).toEqual([{ assetId: "asset-1", role: "product", title: "咖啡杯" }]);
    });

    test("marks changed fields between current and historical revisions", () => {
        const current = revision({ id: "current", version: 3 });
        const previous = revision({ id: "previous", version: 2, plotDescription: "旧版画面", action: "人物向左走", durationMs: 6000 });
        const fields = compareShotRevisions(current, previous);
        expect(fields.find((field) => field.key === "plotDescription")).toMatchObject({ current: "当前镜头画面", selected: "旧版画面", changed: true });
        expect(fields.find((field) => field.key === "action")).toMatchObject({ changed: true });
        expect(fields.find((field) => field.key === "durationSeconds")).toMatchObject({ current: "5s", selected: "6s", changed: true });
        expect(fields.find((field) => field.key === "imagePrompt")).toMatchObject({ changed: false });
    });
});
