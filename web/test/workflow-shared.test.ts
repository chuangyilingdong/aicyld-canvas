import { describe, expect, test } from "bun:test";

import { approvedStoryboardArtifact } from "@/pages/projects/detail/workflow-shared";
import type { ProjectDetail, ProjectShot, ShotArtifact } from "@/services/api/projects";

describe("workflow storyboard approval", () => {
    test("requires both a ready storyboard image and explicit shot approval", () => {
        const shot = {
            id: "shot-1",
            projectId: "project-1",
            unitId: "unit-1",
            currentRevisionId: "revision-1",
            title: "镜头 1",
            description: "画面",
            position: 0,
            durationMs: 5000,
            status: "confirmed",
            reviewStatus: "pending",
            reviewNote: "",
            createdAt: "2026-11-16T00:00:00Z",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ProjectShot;
        const artifact = {
            id: "artifact-1",
            projectId: "project-1",
            unitId: "unit-1",
            shotId: shot.id,
            revisionId: shot.currentRevisionId,
            type: "storyboard",
            version: 1,
            resourceId: "resource-1",
            status: "ready",
            selected: true,
            createdAt: "2026-11-16T00:00:00Z",
            updatedAt: "2026-11-16T00:00:00Z",
        } satisfies ShotArtifact;
        const detail = { shotArtifacts: [artifact] } as ProjectDetail;

        expect(approvedStoryboardArtifact(detail, shot)).toBeUndefined();
        expect(approvedStoryboardArtifact(detail, { ...shot, reviewStatus: "approved" })).toEqual(artifact);
        expect(approvedStoryboardArtifact({ shotArtifacts: [{ ...artifact, status: "stale" }] } as ProjectDetail, { ...shot, reviewStatus: "approved" })).toBeUndefined();
    });
});
