import type { SmartFilmBatchCost } from "@/services/api/smart-film-batches";

export type SmartFilmBatchCostStatus = "pending" | "disabled" | "ready" | "insufficient";

export function smartFilmBatchCostStatus(cost?: Pick<SmartFilmBatchCost, "enabled" | "totalPoints" | "balance"> | null): SmartFilmBatchCostStatus {
    if (!cost) return "pending";
    if (!cost.enabled) return "disabled";
    return cost.totalPoints > cost.balance ? "insufficient" : "ready";
}

export function smartFilmBatchBudgetPoints(cost?: Pick<SmartFilmBatchCost, "enabled" | "totalPoints"> | null) {
    return cost?.enabled ? Math.max(0, Math.trunc(cost.totalPoints)) : 0;
}
