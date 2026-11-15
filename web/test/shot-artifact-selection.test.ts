import { describe, expect, test } from "bun:test";

import type { ProjectShot, ShotArtifact } from "../src/services/api/projects";
import { canSelectShotArtifact } from "../src/pages/projects/detail/shot-artifact-selection";

const shot = { id: "shot-1", projectId: "project-1", currentRevisionId: "revision-2", title: "镜头", description: "", position: 0, durationMs: 3000, status: "confirmed", createdAt: "", updatedAt: "" } satisfies ProjectShot;
const artifact = { id: "artifact-1", projectId: "project-1", shotId: "shot-1", revisionId: "revision-2", type: "storyboard", version: 2, resourceId: "resource-1", status: "ready", selected: false, metadataJson: "{}", createdAt: "", updatedAt: "" } satisfies ShotArtifact;

describe("shot artifact selection", () => {
    test("allows a ready unselected artifact from the current revision", () => {
        expect(canSelectShotArtifact(shot, artifact)).toBe(true);
    });

    test("rejects stale, selected, missing-resource and old-revision artifacts", () => {
        expect(canSelectShotArtifact(shot, { ...artifact, status: "stale" })).toBe(false);
        expect(canSelectShotArtifact(shot, { ...artifact, selected: true })).toBe(false);
        expect(canSelectShotArtifact(shot, { ...artifact, resourceId: undefined })).toBe(false);
        expect(canSelectShotArtifact(shot, { ...artifact, revisionId: "revision-1" })).toBe(false);
    });
});
