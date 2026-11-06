import { describe, expect, test } from "bun:test";

import {
    activeCanvasIdFromPath,
    appUpdateCheckDelayMs,
    beginAppUpdateReloadAttempt,
    fetchAppRelease,
    isNewAppRelease,
    parseAppReleaseManifest,
    projectHasLiveGeneration,
} from "../src/services/app-update";

class MemoryStorage implements Storage {
    private values = new Map<string, string>();
    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key: string) { return this.values.get(key) ?? null; }
    key(index: number) { return [...this.values.keys()][index] ?? null; }
    removeItem(key: string) { this.values.delete(key); }
    setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("hosted app updates", () => {
    test("release manifests are validated and unknown fields are ignored", () => {
        expect(parseAppReleaseManifest({ version: "v2.1.3", commit: "abc1234", buildTime: "2026-11-06T09:00:00Z", buildId: "build-27", files: ["static/a.js", 3] })).toEqual({
            version: "v2.1.3",
            commit: "abc1234",
            buildTime: "2026-11-06T09:00:00Z",
            buildId: "build-27",
            files: ["static/a.js"],
        });
        expect(parseAppReleaseManifest({ version: "v2.1.3" })).toBeNull();
        expect(parseAppReleaseManifest("bad")).toBeNull();
    });

    test("fetch bypasses browser caches and distinguishes a newer build", async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const release = await fetchAppRelease(async (url, init) => {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify({ version: "v2.1.3", commit: "abc1234", buildTime: "2026-11-06T09:00:00Z", buildId: "build-27" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }, "/version.json");
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toStartWith("/version.json?t=");
        expect(calls[0].init?.cache).toBe("no-store");
        expect(isNewAppRelease("build-26", release)).toBe(true);
        expect(isNewAppRelease("build-27", release)).toBe(false);
    });

    test("update checks are jittered between ten and fifteen minutes", () => {
        expect(appUpdateCheckDelayMs(() => 0)).toBe(10 * 60 * 1000);
        expect(appUpdateCheckDelayMs(() => 1)).toBe(15 * 60 * 1000);
        expect(appUpdateCheckDelayMs(() => 0.4)).toBe(12 * 60 * 1000);
    });

    test("only a real canvas route contributes live-generation safety", () => {
        expect(activeCanvasIdFromPath("/canvas/canvas-1")).toBe("canvas-1");
        expect(activeCanvasIdFromPath("/canvas/canvas%201/")).toBe("canvas 1");
        expect(activeCanvasIdFromPath("/canvas")).toBe("");
        expect(activeCanvasIdFromPath("/assets")).toBe("");
        expect(projectHasLiveGeneration({ nodes: [{ metadata: { status: "loading" } }] })).toBe(true);
        expect(projectHasLiveGeneration({ nodes: [{ metadata: { taskStatus: "running" } }] })).toBe(true);
        expect(projectHasLiveGeneration({ nodes: [{ metadata: { status: "success", taskStatus: "succeeded" } }] })).toBe(false);
    });

    test("the same failed update cannot auto-reload in a tight loop", () => {
        const storage = new MemoryStorage();
        expect(beginAppUpdateReloadAttempt("build-27", 1_000, storage)).toBe(true);
        expect(beginAppUpdateReloadAttempt("build-27", 30_000, storage)).toBe(false);
        expect(beginAppUpdateReloadAttempt("build-27", 70_000, storage)).toBe(true);
        expect(beginAppUpdateReloadAttempt("build-28", 71_000, storage)).toBe(true);
    });
});
