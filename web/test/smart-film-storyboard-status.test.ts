import { describe, expect, test } from "bun:test";
import type { GenerationTask } from "@/services/api/task-center";
import { storyboardImageTaskState } from "@/pages/projects/detail/smart-film-storyboard-status";

describe("storyboard image delivery", () => {
    const now = Date.parse("2026-11-25T08:00:00Z");
    const task = { status: "succeeded", createdAt: "2026-11-25T07:59:30Z", updatedAt: "2026-11-25T07:59:30Z" } as GenerationTask;
    test("tracks materialization, failure and a delayed registration", () => {
        expect(storyboardImageTaskState(task, false, now)).toBe("syncing");
        expect(storyboardImageTaskState({ ...task, resultState: "FAILED_PERMANENT" }, false, now)).toBe("delivery-failed");
        expect(storyboardImageTaskState({ ...task, resultState: "FAILED_RETRYABLE" }, false, now)).toBe("delivery-failed");
        expect(storyboardImageTaskState(task, false, now + 31_000)).toBe("sync-delayed");
        expect(storyboardImageTaskState(task, true, now)).toBe("idle");
        expect(storyboardImageTaskState({ ...task, status: "running" }, false, now)).toBe("generating");
    });
});
