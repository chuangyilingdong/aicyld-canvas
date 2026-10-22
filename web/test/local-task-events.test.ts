import { expect, test } from "bun:test";
import { shouldUseTaskTextEvents } from "../src/services/api/task-center";
import { isCanvasTaskVisibleInActivePanel, shouldEnableCanvasActiveTaskQuery } from "../src/pages/canvas/use-canvas-active-tasks";
import type { GenerationTask } from "../src/services/api/task-center";

test("media task waits use durable task status polling instead of the text-only SSE path", () => {
    expect(shouldUseTaskTextEvents({})).toBe(false);
    expect(shouldUseTaskTextEvents({ onTaskUpdate: () => undefined })).toBe(false);
});

test("text generation opts into resumable SSE when it needs text deltas", () => {
    expect(shouldUseTaskTextEvents({ onTextDelta: () => undefined })).toBe(true);
    expect(shouldUseTaskTextEvents({ useTextEvents: true })).toBe(true);
});

test("local canvas task panel continues querying authoritative task state", () => {
    expect(shouldEnableCanvasActiveTaskQuery(true, "local-project")).toBe(true);
    expect(shouldEnableCanvasActiveTaskQuery(false, "local-project")).toBe(false);
    expect(shouldEnableCanvasActiveTaskQuery(true, "")).toBe(false);
});

test("canvas task panel keeps just-finished tasks long enough to show billing outcome", () => {
    const now = Date.parse("2026-10-23T02:00:30+08:00");
    const task = (status: GenerationTask["status"], completedAt: string) => ({ status, completedAt } as GenerationTask);

    expect(isCanvasTaskVisibleInActivePanel(task("running", ""), now)).toBe(true);
    expect(isCanvasTaskVisibleInActivePanel(task("succeeded", "2026-10-23T02:00:10+08:00"), now)).toBe(true);
    expect(isCanvasTaskVisibleInActivePanel(task("succeeded", "2026-10-23T01:59:50+08:00"), now)).toBe(false);
});
