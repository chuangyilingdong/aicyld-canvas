import { describe, expect, test } from "bun:test";

import {
    browserLocalCanvasMediaTargets,
    migrateBrowserLocalCanvasMedia,
    type CanvasLocalMediaMigrationDependencies,
} from "@/lib/canvas/canvas-local-media-migration";
import { resourceFileUrl, resourceStorageKey, type RemoteResource, type ResourceUploadMeta } from "@/services/api/resources";
import { captureUserScope } from "@/lib/user-scope-guard";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

function canvasNode(id: string, type: CanvasNodeData["type"], metadata: CanvasNodeMetadata = {}, title = "本地素材"): CanvasNodeData {
    return { id, type, title, position: { x: 0, y: 0 }, width: 512, height: 512, metadata };
}

function uploadedResource(id: string, overrides: Partial<RemoteResource> = {}): RemoteResource {
    return {
        id,
        userId: "u1",
        kind: "image",
        status: "ready",
        provider: "oss",
        endpoint: "",
        bucket: "",
        objectKey: `objects/${id}`,
        publicUrl: "",
        mimeType: "image/png",
        size: 12,
        createdAt: "2026-10-15T00:00:00Z",
        ...overrides,
    };
}

function dependencies(overrides: Partial<CanvasLocalMediaMigrationDependencies> = {}): CanvasLocalMediaMigrationDependencies {
    return {
        browserLocalResourceStore: () => false,
        readBlob: async () => new Blob(["bytes"], { type: "image/png" }),
        uploadResource: async (_blob, kind) => uploadedResource("res-1", { kind }),
        ensureAssetId: async () => "asset-1",
        ...overrides,
    };
}

describe("browserLocalCanvasMediaTargets", () => {
    test("只挑「有 storageKey 但解析不出服务端资源」的媒体节点", () => {
        const nodes = [
            canvasNode("a", CanvasNodeType.Image, { storageKey: "resource:abc", content: "/api/resources/abc/file" }),
            canvasNode("b", CanvasNodeType.Image, { storageKey: "image:sso_x:yyy", content: "blob:https://hb.aicyld.com.cn/zz" }),
            canvasNode("c", CanvasNodeType.Text, { content: "纯文本" }),
            canvasNode("d", CanvasNodeType.Video, { storageKey: "video:sso_x:vv" }),
            canvasNode("e", CanvasNodeType.Audio, { storageKey: "resource:aud", content: "/api/resources/aud/file" }),
            canvasNode("f", CanvasNodeType.Image, {}),
            canvasNode("g", CanvasNodeType.Image, { storageKey: "   " }),
        ];
        expect(browserLocalCanvasMediaTargets(nodes)).toEqual([
            { nodeId: "b", storageKey: "image:sso_x:yyy", kind: "image" },
            { nodeId: "d", storageKey: "video:sso_x:vv", kind: "video" },
        ]);
    });
});

describe("migrateBrowserLocalCanvasMedia", () => {
    test("补传成功：节点改写成 resource: 键 + 服务端地址 + 回填 assetId", async () => {
        const calls: { kind: string; meta: ResourceUploadMeta }[] = [];
        const nodes = [
            canvasNode("img", CanvasNodeType.Image, { storageKey: "image:sso_x:yyy", content: "blob:https://hb.aicyld.com.cn/zz", naturalWidth: 800, naturalHeight: 600 }),
            canvasNode("keep", CanvasNodeType.Image, { storageKey: "resource:keep", content: "/api/resources/keep/file" }),
        ];
        const result = await migrateBrowserLocalCanvasMedia(
            nodes,
            { canvasId: "canvas-1" },
            dependencies({
                uploadResource: async (blob, kind, meta) => {
                    calls.push({ kind, meta });
                    expect(blob.size).toBeGreaterThan(0);
                    return uploadedResource("res-1", { kind });
                },
            }),
        );

        expect(result.migrated).toBe(1);
        expect(result.failures).toEqual([]);
        expect(calls).toHaveLength(1);
        expect(calls[0].kind).toBe("image");
        // 幂等键沿用旧 storageKey：重复打开画布不会重复上传
        expect(calls[0].meta.idempotencyKey).toBe("image:sso_x:yyy");
        expect(calls[0].meta.width).toBe(800);
        expect(calls[0].meta.height).toBe(600);
        expect(calls[0].meta.expectedScope).toEqual(captureUserScope());

        const migrated = result.nodes[0];
        expect(migrated.metadata?.storageKey).toBe(resourceStorageKey("res-1"));
        expect(migrated.metadata?.content).toBe(resourceFileUrl("res-1"));
        expect(migrated.metadata?.assetId).toBe("asset-1");
        // 已经指向服务端资源的节点原样保留（同一个引用，不做无意义改写）
        expect(result.nodes[1]).toBe(nodes[1]);
    });

    test("浏览器本地已经没有这份媒体：保留原节点并记 failure", async () => {
        const nodes = [canvasNode("img", CanvasNodeType.Image, { storageKey: "image:sso_x:yyy", content: "blob:https://hb.aicyld.com.cn/zz" })];
        const result = await migrateBrowserLocalCanvasMedia(
            nodes,
            { canvasId: "canvas-1" },
            dependencies({ readBlob: async () => null }),
        );
        expect(result.migrated).toBe(0);
        expect(result.nodes[0]).toBe(nodes[0]);
        expect(result.failures[0]).toContain("浏览器本地缓存里已经没有这份媒体");
    });

    test("上传失败：保留原节点，storageKey 不动", async () => {
        const nodes = [canvasNode("img", CanvasNodeType.Image, { storageKey: "image:sso_x:yyy", content: "blob:https://hb.aicyld.com.cn/zz" })];
        const result = await migrateBrowserLocalCanvasMedia(
            nodes,
            { canvasId: "canvas-1" },
            dependencies({ uploadResource: async () => { throw new Error("直传失败"); } }),
        );
        expect(result.migrated).toBe(0);
        expect(result.nodes[0]).toBe(nodes[0]);
        expect(result.nodes[0].metadata?.storageKey).toBe("image:sso_x:yyy");
        expect(result.failures[0]).toContain("直传失败");
    });

    test("素材记录没落地就不改写节点（宁可不改，也不能让整份画布提交被媒体校验拒绝）", async () => {
        const nodes = [canvasNode("img", CanvasNodeType.Image, { storageKey: "image:sso_x:yyy", content: "blob:https://hb.aicyld.com.cn/zz" })];
        const result = await migrateBrowserLocalCanvasMedia(
            nodes,
            { canvasId: "canvas-1" },
            dependencies({ ensureAssetId: async () => "" }),
        );
        expect(result.migrated).toBe(0);
        expect(result.nodes[0]).toBe(nodes[0]);
        expect(result.failures[0]).toContain("素材记录没有落地");
    });

    test("本地/桌面形态直接跳过：IndexedDB 就是持久库", async () => {
        let uploaded = 0;
        const nodes = [canvasNode("img", CanvasNodeType.Image, { storageKey: "image:sso_x:yyy", content: "blob:https://hb.aicyld.com.cn/zz" })];
        const result = await migrateBrowserLocalCanvasMedia(
            nodes,
            { canvasId: "canvas-1" },
            dependencies({ browserLocalResourceStore: () => true, uploadResource: async () => { uploaded += 1; return uploadedResource("res-1"); } }),
        );
        expect(uploaded).toBe(0);
        expect(result.migrated).toBe(0);
        expect(result.nodes[0]).toBe(nodes[0]);
    });

    test("没有本地媒体时是零成本空转", async () => {
        const nodes = [canvasNode("img", CanvasNodeType.Image, { storageKey: "resource:abc", content: "/api/resources/abc/file" })];
        let uploaded = 0;
        const result = await migrateBrowserLocalCanvasMedia(
            nodes,
            { canvasId: "canvas-1" },
            dependencies({ uploadResource: async () => { uploaded += 1; return uploadedResource("res-1"); } }),
        );
        expect(uploaded).toBe(0);
        expect(result).toEqual({ nodes: [...nodes], migrated: 0, failures: [] });
    });
});