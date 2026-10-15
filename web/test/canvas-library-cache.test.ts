import { describe, expect, spyOn, test } from "bun:test";

import { appQueryClient } from "@/lib/query-client";
import { invalidateCanvasLibraryQueries } from "@/services/canvas-library-cache";
import { deleteWorkspaceCanvasProjects } from "@/services/workspace-project-repository";

function capturedKeys(spy: ReturnType<typeof spyOn>) {
    return (spy.mock.calls as unknown[][]).map((call) => JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey));
}

describe("画布列表缓存失效", () => {
    test("helper 会同时失效画布列表与首页最近项目", () => {
        const spy = spyOn(appQueryClient, "invalidateQueries");
        try {
            invalidateCanvasLibraryQueries();
            const keys = capturedKeys(spy);
            expect(keys).toContain('["canvas-library"]');
            expect(keys).toContain('["beeftv-home-canvases"]');
        } finally {
            spy.mockRestore();
        }
    });

    test("删除画布后必须失效缓存（服务端已删但卡片还留在屏幕上就是这个回归）", async () => {
        const spy = spyOn(appQueryClient, "invalidateQueries");
        try {
            await deleteWorkspaceCanvasProjects([]);
            expect(capturedKeys(spy)).toContain('["canvas-library"]');
        } finally {
            spy.mockRestore();
        }
    });
});