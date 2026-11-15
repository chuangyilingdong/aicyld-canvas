import { describe, expect, test } from "bun:test";

import { removeProjectAssetCandidateFromPage } from "../src/pages/projects/detail/project-asset-candidate-state";
import type { ProjectAssetCandidate, ProjectAssetCandidatePage } from "../src/services/api/projects";

function candidate(id: string): ProjectAssetCandidate {
    return {
        id,
        projectId: "project-1",
        name: id,
        category: "environment",
        status: "pending_confirmation",
        detailsJson: "{}",
        createdAt: "2026-11-15T00:00:00Z",
        updatedAt: "2026-11-15T00:00:00Z",
    };
}

function page(candidates: ProjectAssetCandidate[], overrides: Partial<ProjectAssetCandidatePage> = {}): ProjectAssetCandidatePage {
    return {
        candidates,
        page: 1,
        pageSize: 2,
        total: candidates.length,
        hasMore: false,
        ...overrides,
    };
}

describe("project asset candidate confirmation state", () => {
    test("removes a confirmed candidate immediately and updates pagination totals", () => {
        const before = page([candidate("candidate-1"), candidate("candidate-2")], { total: 3, hasMore: true });
        const after = removeProjectAssetCandidateFromPage(before, "candidate-1");

        expect(after.candidates.map((item) => item.id)).toEqual(["candidate-2"]);
        expect(after.total).toBe(2);
        expect(after.hasMore).toBe(false);
        expect(before.candidates).toHaveLength(2);
    });

    test("keeps the same page object when the candidate is not present", () => {
        const before = page([candidate("candidate-1")]);
        expect(removeProjectAssetCandidateFromPage(before, "candidate-2")).toBe(before);
    });
});
