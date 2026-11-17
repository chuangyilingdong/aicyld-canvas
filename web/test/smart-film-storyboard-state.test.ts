import { expect, test } from "bun:test";

import { resolveStoryboardWaitState } from "@/pages/projects/detail/smart-film-production-board";
import type { SmartFilmProductionRun } from "@/services/api/smart-film-batches";
import type { GenerationTask } from "@/services/api/task-center";

function task(status: GenerationTask["status"]): GenerationTask {
    return { id: "task", type: "canvas_text", operation: "storyboard", status, prompt: "", attempts: 0, createdAt: "", updatedAt: "" };
}

function run(overrides: Partial<SmartFilmProductionRun> = {}): SmartFilmProductionRun {
    return {
        id: "run", batchId: "batch", scriptId: "script", status: "pending", currentStep: "storyboard",
        resources: {}, assetStatus: "confirmed", storyboardStatus: "waiting", controlStatus: "ready", attempts: 1, revision: 1,
        createdAt: "", updatedAt: "",
        ...overrides,
    } as SmartFilmProductionRun;
}

test("failed storyboard tasks produce a visible failure state", () => {
    expect(resolveStoryboardWaitState(task("failed"), run())).toBe("failed");
    expect(resolveStoryboardWaitState(undefined, run({ status: "needs_attention", storyboardStatus: "needs_attention" }))).toBe("failed");
});

test("queued, running and returned storyboard tasks have distinct states", () => {
    expect(resolveStoryboardWaitState(task("queued"), run())).toBe("running");
    expect(resolveStoryboardWaitState(task("running"), run())).toBe("running");
    expect(resolveStoryboardWaitState(task("succeeded"), run())).toBe("syncing");
    expect(resolveStoryboardWaitState(undefined, run())).toBe("waiting");
});
