import { expect, test } from "bun:test";

import { restoreCanvasArchive, type CanvasArchiveRestoreHost } from "@/lib/canvas/canvas-archive-restore";
import { createZip } from "@/lib/zip";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasNodeData } from "@/types/canvas";

function memoryHost() {
    const projects: CanvasProject[] = [];
    const binds: CanvasNodeData[] = [];
    const uploads: string[] = [];
    let resourceSeq = 0;
    let bindSeq = 0;
    const host: Partial<CanvasArchiveRestoreHost> = {
        usesCanonicalBackend: true,
        createFolder: () => "folder-new",
        deleteFolder: () => undefined,
        importProject: (project) => {
            const id = `canvas-${projects.length + 1}`;
            projects.push({
                id,
                revision: 0,
                workspaceProjectId: id,
                title: project.title || "导入画布",
                createdAt: "2026-11-21T00:00:00.000Z",
                updatedAt: "2026-11-21T00:00:00.000Z",
                nodes: (project.nodes || []) as CanvasNodeData[],
                connections: project.connections || [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "dots",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
                directorScenes: project.directorScenes || [],
                timeline: project.timeline,
            });
            return id;
        },
        updateProject: (id, patch) => {
            const index = projects.findIndex((project) => project.id === id);
            if (index >= 0) projects[index] = { ...projects[index], ...patch };
        },
        persistProject: async () => undefined,
        deleteProjects: async (ids) => {
            for (const id of ids) {
                const index = projects.findIndex((project) => project.id === id);
                if (index >= 0) projects.splice(index, 1);
            }
        },
        discardProjects: (ids) => {
            for (const id of ids) {
                const index = projects.findIndex((project) => project.id === id);
                if (index >= 0) projects.splice(index, 1);
            }
        },
        uploadMedia: async (_blob, _kind, meta) => {
            uploads.push(meta.storageKey);
            const id = `new-res-${++resourceSeq}`;
            return {
                storageKey: `resource:${id}`,
                url: `/api/resources/${id}/file`,
                resourceId: id,
            };
        },
        bindMediaAsset: async ({ node }) => {
            binds.push(node);
            return `asset-${++bindSeq}`;
        },
        saveDrawing: async (projectId, drawingId) => ({
            projectId,
            drawingId,
            version: 2,
            engine: "excalidraw",
            snapshot: {},
            revision: 1,
            updatedAt: "2026-11-21T00:00:00.000Z",
            shapeCount: 0,
            pageCount: 1,
        }),
        loadDrawing: async (_projectId, drawingId) => ({ drawingId, revision: 1, snapshot: {} }),
        deleteResource: async () => undefined,
    };
    return { host, projects, binds, uploads };
}

function mediaNode(id: string, type: "image" | "video" | "audio", storageKey: string, extra: Record<string, unknown> = {}): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {
            storageKey,
            content: `/api/resources/${storageKey.slice("resource:".length)}/file`,
            assetId: `foreign-${id}`,
            taskId: `foreign-task-${id}`,
            ...extra,
        },
    };
}

test("cross-machine restore remaps the full media tree, shared resources, and image history", async () => {
    const shared = "resource:old-shared";
    const history = "resource:old-history";
    const audio = "resource:old-audio";
    const video = "resource:old-video";
    const preview = "resource:old-preview";
    const lastFrame = "resource:old-last-frame";
    const missing = "resource:old-missing";
    const data = {
        app: "infinite-canvas",
        version: 4,
        exportedAt: "2026-11-21T00:00:00.000Z",
        projects: [{
            project: {
                id: "foreign-canvas",
                title: "跨机全树",
                nodes: [
                    mediaNode("image-a", "image", shared, {
                        imageHistory: [
                            { id: "history-only", storageKey: history, content: `/api/resources/old-history/file`, assetId: "foreign-history" },
                            { id: "history-missing", storageKey: missing, content: `/api/resources/old-missing/file` },
                            { id: "history-active", storageKey: shared, content: `/api/resources/old-shared/file`, assetId: "foreign-image-a" },
                        ],
                    }),
                    mediaNode("image-b", "image", shared),
                    mediaNode("video", "video", video, {
                        videoPreview: { storageKey: preview, content: `/api/resources/old-preview/file` },
                        lastFrameStorageKey: lastFrame,
                        lastFrameUrl: `/api/resources/old-last-frame/file`,
                    }),
                    {
                        id: "note",
                        type: "text",
                        title: "正文",
                        position: { x: 0, y: 0 },
                        width: 240,
                        height: 120,
                        metadata: { content: `正文里的 ${missing} 不是媒体引用` },
                    },
                ],
                connections: [],
                timeline: {
                    version: 2,
                    durationMs: 1000,
                    tracks: [{ id: "voice", kind: "audio", label: "配音", order: 0 }],
                    clips: [{
                        id: "clip",
                        kind: "audio",
                        nodeId: "video",
                        trackId: "voice",
                        startMs: 0,
                        durationMs: 1000,
                        directMedia: { id: "audio", kind: "audio", title: "配音", storageKey: audio, url: "/api/resources/old-audio/file", assetId: "foreign-clip" },
                    }],
                },
                directorScenes: [{
                    id: "scene",
                    panorama: { storageKey: video, url: "/api/resources/old-video/file", rotation: 0 },
                    objects: [{ id: "actor", storageKey: preview, url: "/api/resources/old-preview/file", assetId: "foreign-actor" }],
                    shots: [{ id: "shot", screenshots: [{ id: "shot-image", storageKey: lastFrame, url: "/api/resources/old-last-frame/file" }] }],
                }],
            },
            files: [shared, history, audio, video, preview, lastFrame].map((storageKey) => ({
                storageKey,
                path: `projects/foreign-canvas/files/${storageKey.slice("resource:".length)}.bin`,
                mimeType: storageKey === audio ? "audio/mpeg" : storageKey === video ? "video/mp4" : "image/png",
                bytes: 4,
            })),
            drawingDocuments: [],
        }],
    };
    const zip = await createZip([
        { name: "projects.json", data: JSON.stringify(data) },
        ...data.projects[0].files.map((file) => ({ name: file.path, data: new Uint8Array([1, 2, 3, 4]) })),
    ]);

    const state = memoryHost();
    const result = await restoreCanvasArchive(zip, state.host);
    expect(result.skippedFiles).toEqual([{ owner: "跨机全树", reference: missing }]);
    const project = state.projects[0];
    const imageA = project.nodes.find((node) => node.id === "image-a")!;
    const imageB = project.nodes.find((node) => node.id === "image-b")!;
    expect(imageA.metadata?.storageKey).toBe(imageB.metadata?.storageKey);
    expect(imageA.metadata?.assetId).toBe(imageB.metadata?.assetId);
    expect(imageA.metadata?.taskId).toBeUndefined();

    const imageHistory = imageA.metadata?.imageHistory || [];
    expect(imageHistory).toHaveLength(2);
    expect(imageHistory[0].storageKey).not.toBe(shared);
    expect(imageHistory[0].content).toStartWith("/api/resources/");
    expect(imageHistory[0].assetId).toBeUndefined();
    expect(imageHistory[1].storageKey).toBe(imageA.metadata?.storageKey);
    expect(imageHistory[1].assetId).toBe(imageA.metadata?.assetId);

    const videoNode = project.nodes.find((node) => node.id === "video")!;
    expect(videoNode.metadata?.videoPreview?.storageKey).toStartWith("resource:new-res-");
    expect(videoNode.metadata?.videoPreview?.content).toStartWith("/api/resources/");
    expect(videoNode.metadata?.lastFrameStorageKey).toStartWith("resource:new-res-");
    expect(videoNode.metadata?.lastFrameUrl).toContain(videoNode.metadata!.lastFrameStorageKey!.slice("resource:".length));

    const note = project.nodes.find((node) => node.id === "note")!;
    expect(note.metadata?.content).toBe(`正文里的 ${missing} 不是媒体引用`);
    expect(project.timeline?.clips[0].directMedia?.storageKey).toStartWith("resource:new-res-");
    expect(project.timeline?.clips[0].directMedia?.assetId).toBeTruthy();
    expect(project.directorScenes[0].panorama?.storageKey).toBe(videoNode.metadata?.storageKey);
    expect(project.directorScenes[0].objects[0].assetId).toBeUndefined();
    expect(project.directorScenes[0].shots[0].screenshots?.[0].storageKey).toBe(videoNode.metadata?.lastFrameStorageKey);

    // Shared media binds one asset, while the timeline gets its own clip asset.
    expect(state.binds).toHaveLength(3);
    expect(state.uploads).toHaveLength(6);
});

test("URL-only packaged media is remapped while an unpackaged external CDN remains intact", async () => {
    const external = "https://cdn.example.com/api/resources/external-id/file";
    const data = {
        app: "infinite-canvas",
        version: 4,
        exportedAt: "2026-11-21T00:00:00.000Z",
        projects: [{
            project: {
                id: "foreign-url",
                title: "URL-only",
                nodes: [
                    {
                        id: "hosted",
                        type: "image",
                        title: "托管图",
                        position: { x: 0, y: 0 },
                        width: 240,
                        height: 240,
                        metadata: { content: "http://127.0.0.1:19999/api/resources/old-hosted/file" },
                    },
                    {
                        id: "external",
                        type: "image",
                        title: "外链图",
                        position: { x: 260, y: 0 },
                        width: 240,
                        height: 240,
                        metadata: { content: external },
                    },
                ],
                connections: [],
            },
            files: [{
                storageKey: "resource:old-hosted",
                path: "projects/foreign-url/files/hosted.png",
                mimeType: "image/png",
                bytes: 4,
            }],
            drawingDocuments: [],
        }],
    };
    const zip = await createZip([
        { name: "projects.json", data: JSON.stringify(data) },
        { name: "projects/foreign-url/files/hosted.png", data: new Uint8Array([9, 8, 7, 6]) },
    ]);
    const state = memoryHost();
    const result = await restoreCanvasArchive(zip, state.host);
    expect(result.skippedFiles).toBeUndefined();
    const hosted = state.projects[0].nodes.find((node) => node.id === "hosted")!;
    const unchanged = state.projects[0].nodes.find((node) => node.id === "external")!;
    expect(hosted.metadata?.storageKey).toBe(`resource:${result.resourceIds[0]}`);
    expect(hosted.metadata?.content).toBe(`/api/resources/${result.resourceIds[0]}/file`);
    expect(unchanged.metadata?.storageKey).toBeUndefined();
    expect(unchanged.metadata?.content).toBe(external);
});
