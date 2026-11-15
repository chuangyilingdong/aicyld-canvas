import type { ProjectAssetCandidatePage } from "@/services/api/projects";

export function removeProjectAssetCandidateFromPage(page: ProjectAssetCandidatePage, candidateId: string): ProjectAssetCandidatePage {
    const candidates = page.candidates.filter((candidate) => candidate.id !== candidateId);
    if (candidates.length === page.candidates.length) return page;
    const total = Math.max(0, page.total - 1);
    return {
        ...page,
        candidates,
        total,
        hasMore: total > page.page * page.pageSize,
    };
}
