import { describe, expect, test } from "bun:test";
import { mergeCanvasProjectLibraryEntries } from "../src/lib/canvas/canvas-project-library-order";

describe("canvas project library order", () => {
    const studio = [
        { id: "studio-old", project: { id: "studio-old", name: "成片旧项目", updatedAt: "2026-11-18T10:00:00Z" } },
        { id: "studio-new", project: { id: "studio-new", name: "成片新项目", updatedAt: "2026-11-20T10:00:00Z" } },
    ];
    const canvases = [
        { id: "canvas-middle", title: "画布中间", updatedAt: "2026-11-19T10:00:00Z", nodeCount: 8 },
        { id: "canvas-new", title: "画布最新", updatedAt: "2026-11-20T12:00:00Z", nodeCount: 2 },
    ];

    test("merges both project sources into one newest-first sequence", () => {
        expect(mergeCanvasProjectLibraryEntries(studio, canvases, "updated").map((entry) => entry.kind === "studio" ? entry.item.id : entry.project.id))
            .toEqual(["canvas-new", "studio-new", "canvas-middle", "studio-old"]);
    });

    test("name and node-count sorts retain the same unified collection", () => {
        expect(mergeCanvasProjectLibraryEntries(studio, canvases, "name").map((entry) => entry.name))
            .toEqual(["成片旧项目", "成片新项目", "画布中间", "画布最新"]);
        expect(mergeCanvasProjectLibraryEntries(studio, canvases, "nodes").slice(0, 2).map((entry) => entry.kind))
            .toEqual(["canvas", "canvas"]);
    });
});
