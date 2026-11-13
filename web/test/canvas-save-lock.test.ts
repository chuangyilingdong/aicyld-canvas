import { describe, expect, test } from "bun:test";

import { canvasSaveLockKey, withCanvasSaveLock } from "@/services/canvas-save-lock";

class MemoryStorage {
    private readonly values = new Map<string, string>();
    getItem(key: string) {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string) {
        this.values.set(key, value);
    }
    removeItem(key: string) {
        this.values.delete(key);
    }
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cross-tab canvas save lock", () => {
    test("serializes saves from two tabs with the localStorage fallback", async () => {
        const storage = new MemoryStorage();
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstHold = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = withCanvasSaveLock(
            "scope",
            "canvas",
            async () => {
                events.push("first:start");
                await firstHold;
                events.push("first:end");
            },
            { storage, useWebLocks: false, ownerId: "tab-a", waitMs: 2_000, leaseMs: 5_000 },
        );

        await tick();
        const second = withCanvasSaveLock(
            "scope",
            "canvas",
            async () => {
                events.push("second:start");
                events.push("second:end");
            },
            { storage, useWebLocks: false, ownerId: "tab-b", waitMs: 2_000, leaseMs: 5_000 },
        );

        await tick(80);
        expect(events).toEqual(["first:start"]);
        expect(storage.getItem(canvasSaveLockKey("scope", "canvas"))).not.toBeNull();

        releaseFirst();
        await Promise.all([first, second]);
        expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
        expect(storage.getItem(canvasSaveLockKey("scope", "canvas"))).toBeNull();
    });
});
