import type { ProjectSummary } from "@/services/api/projects";

export type ProjectBatchGroup = {
    key: string;
    batchId?: string;
    projects: ProjectSummary[];
    updatedAt: string;
};

export function groupProjectsByBatch(rows: ProjectSummary[]): ProjectBatchGroup[] {
    const groups = new Map<string, ProjectBatchGroup>();
    for (const row of rows) {
        const batchId = row.project.batchId?.trim() || "";
        const key = batchId || "__independent__";
        const current = groups.get(key);
        if (current) {
            current.projects.push(row);
            if (row.project.updatedAt > current.updatedAt) current.updatedAt = row.project.updatedAt;
        } else {
            groups.set(key, {
                key,
                ...(batchId ? { batchId } : {}),
                projects: [row],
                updatedAt: row.project.updatedAt,
            });
        }
    }
    return Array.from(groups.values()).sort((left, right) => {
        if (Boolean(left.batchId) !== Boolean(right.batchId)) return left.batchId ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
    });
}
