import { describe, expect, test } from "bun:test";

import { smartFilmBatchBudgetPoints, smartFilmBatchCostStatus } from "@/lib/canvas/smart-film-batch-cost";

describe("smart-film batch cost", () => {
    test("distinguishes disabled, affordable and insufficient quotes", () => {
        expect(smartFilmBatchCostStatus()).toBe("pending");
        expect(smartFilmBatchCostStatus({ enabled: false, totalPoints: 0, balance: 0 })).toBe("disabled");
        expect(smartFilmBatchCostStatus({ enabled: true, totalPoints: 30, balance: 30 })).toBe("ready");
        expect(smartFilmBatchCostStatus({ enabled: true, totalPoints: 31, balance: 30 })).toBe("insufficient");
    });

    test("only persists a real enabled quote as the batch budget", () => {
        expect(smartFilmBatchBudgetPoints()).toBe(0);
        expect(smartFilmBatchBudgetPoints({ enabled: false, totalPoints: 99 })).toBe(0);
        expect(smartFilmBatchBudgetPoints({ enabled: true, totalPoints: 42 })).toBe(42);
    });
});
