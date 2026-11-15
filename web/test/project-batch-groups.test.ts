import { describe, expect, test } from "bun:test";

import { groupProjectsByBatch } from "../src/pages/projects/project-batch-groups";
import type { ProjectSummary } from "../src/services/api/projects";

function row(id: string, batchId: string | undefined, updatedAt: string) {
    return {
        project: { id, batchId, updatedAt },
        canvasCount: 0,
        assetCount: 0,
        unitCount: 0,
        completedUnitCount: 0,
    } as ProjectSummary;
}

describe("project batch groups", () => {
    test("groups child projects by batch and keeps independent projects separate", () => {
        const groups = groupProjectsByBatch([
            row("p1", "batch-a", "2026-11-14T10:00:00Z"),
            row("p2", "batch-a", "2026-11-14T11:00:00Z"),
            row("p3", "batch-b", "2026-11-14T09:00:00Z"),
            row("p4", undefined, "2026-11-14T12:00:00Z"),
        ]);

        expect(groups.map((group) => group.batchId || "independent")).toEqual(["batch-a", "batch-b", "independent"]);
        expect(groups[0]?.projects.map((item) => item.project.id)).toEqual(["p1", "p2"]);
        expect(groups[0]?.updatedAt).toBe("2026-11-14T11:00:00Z");
        expect(groups[2]?.projects.map((item) => item.project.id)).toEqual(["p4"]);
    });
});
