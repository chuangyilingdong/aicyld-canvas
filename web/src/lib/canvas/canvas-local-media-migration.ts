import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile, type ResourceUploadMeta } from "@/services/api/resources";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";

/**
 * 托管站的本地媒体补传（一次性升级，幂等，失败不影响打开画布）。
 *
 * 背景：这个部署曾按「本地/桌面」形态跑过（构建期漏了 VITE_CANVAS_LOCAL_MODE=false），
 * 那段时间的上传落进浏览器 IndexedDB，节点里留下 `image:<scope>:<id>` 这类 storageKey
 * 和会话级 `blob:` 地址。这批媒体服务端没有任何副本——换设备、清站点数据、换浏览器都会丢。
 *
 * 画布打开时把它们补传成服务端资源，并把节点改写成 resource: 键 + 真 assetId
 * （画布提交的媒体强校验要求 resource 必须对应一条本人素材，否则整份提交会被拒绝）。
 * 改写不自洽就退回原节点：宁可不改，也不让画布变成存不上。
 */

export type BrowserLocalCanvasMediaKind = "image" | "video" | "audio";

export type BrowserLocalCanvasMediaTarget = {
    nodeId: string;
    storageKey: string;
    kind: BrowserLocalCanvasMediaKind;
};

export type CanvasLocalMediaMigrationResult = {
    nodes: CanvasNodeData[];
    migrated: number;
    failures: string[];
};

type UploadedResource = Awaited<ReturnType<typeof uploadResourceFile>>;

export type CanvasLocalMediaMigrationDependencies = {
    browserLocalResourceStore: () => boolean;
    readBlob: (kind: BrowserLocalCanvasMediaKind, storageKey: string) => Promise<Blob | null>;
    uploadResource: (blob: Blob, kind: BrowserLocalCanvasMediaKind, meta: ResourceUploadMeta) => Promise<UploadedResource>;
    ensureAssetId: (node: CanvasNodeData, canvasId: string, expected: CapturedUserScope) => Promise<string>;
};

const defaultDependencies: CanvasLocalMediaMigrationDependencies = {
    browserLocalResourceStore: usesBrowserLocalResourceStore,
    readBlob: (kind, storageKey) => kind === "image" ? getImageBlob(storageKey) : getMediaBlob(storageKey),
    uploadResource: (blob, kind, meta) => uploadResourceFile(blob, kind, meta),
    ensureAssetId: async (node, canvasId, expected) => {
        const asset = await ensureCanvasNodeAsset({
            canvasId,
            node,
            source: "canvas-upload",
            expectedScope: expected,
        });
        return asset.assetId;
    },
};

function canvasMediaKind(type: CanvasNodeData["type"]): BrowserLocalCanvasMediaKind | undefined {
    if (type === CanvasNodeType.Image) return "image";
    if (type === CanvasNodeType.Video) return "video";
    if (type === CanvasNodeType.Audio) return "audio";
    return undefined;
}

/** 挑出「只存在于浏览器本地」的画布媒体：有 storageKey，但解析不出对应的服务端资源。 */
export function browserLocalCanvasMediaTargets(nodes: readonly CanvasNodeData[]): BrowserLocalCanvasMediaTarget[] {
    const targets: BrowserLocalCanvasMediaTarget[] = [];
    for (const node of nodes) {
        const storageKey = node.metadata?.storageKey?.trim();
        if (!storageKey || resourceIdFromStorageKey(storageKey)) continue;
        const kind = canvasMediaKind(node.type);
        if (!kind) continue;
        targets.push({ nodeId: node.id, storageKey, kind });
    }
    return targets;
}

function canvasMediaFileName(node: CanvasNodeData, kind: BrowserLocalCanvasMediaKind) {
    const extension = kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3";
    const title = (node.title || "本地素材").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 48);
    return `${title || "本地素材"}.${extension}`;
}

/**
 * 逐节点补传：读浏览器本地 blob → 上传成服务端资源 → 取真素材 id → 改写节点。
 * 单节点失败只记一条 failure 并保留原节点，绝不中断整块画布。
 */
export async function migrateBrowserLocalCanvasMedia(
    nodes: readonly CanvasNodeData[],
    options: { canvasId: string; expectedScope?: CapturedUserScope; signal?: AbortSignal },
    dependencies: CanvasLocalMediaMigrationDependencies = defaultDependencies,
): Promise<CanvasLocalMediaMigrationResult> {
    const expected = options.expectedScope ?? captureUserScope();
    // 本地/桌面形态下浏览器 IndexedDB 就是这台机器的持久库，不需要（也不应该）往上搬。
    if (dependencies.browserLocalResourceStore()) return { nodes: [...nodes], migrated: 0, failures: [] };
    const targets = browserLocalCanvasMediaTargets(nodes);
    if (!targets.length) return { nodes: [...nodes], migrated: 0, failures: [] };
    const byNodeId = new Map(targets.map((target) => [target.nodeId, target]));
    const next: CanvasNodeData[] = [];
    const failures: string[] = [];
    let migrated = 0;
    for (const node of nodes) {
        const target = byNodeId.get(node.id);
        if (!target) {
            next.push(node);
            continue;
        }
        try {
            const blob = await dependencies.readBlob(target.kind, target.storageKey);
            if (!blob) {
                failures.push(`${node.id}: 浏览器本地缓存里已经没有这份媒体`);
                next.push(node);
                continue;
            }
            const resource = await dependencies.uploadResource(blob, target.kind, {
                fileName: canvasMediaFileName(node, target.kind),
                width: node.metadata?.naturalWidth,
                height: node.metadata?.naturalHeight,
                durationMs: node.metadata?.durationMs,
                // 幂等键沿用旧 storageKey：重复打开画布不会重复上传。
                idempotencyKey: target.storageKey,
                expectedScope: expected,
            });
            const rewritten: CanvasNodeData = {
                ...node,
                metadata: {
                    ...node.metadata,
                    storageKey: resourceStorageKey(resource.id),
                    content: resource.publicUrl || resourceFileUrl(resource.id),
                    mimeType: node.metadata?.mimeType || resource.mimeType,
                    bytes: node.metadata?.bytes || resource.size,
                },
            };
            const assetId = await dependencies.ensureAssetId(rewritten, options.canvasId, expected);
            if (!assetId) {
                failures.push(`${node.id}: 素材记录没有落地，先不改写节点`);
                next.push(node);
                continue;
            }
            next.push({ ...rewritten, metadata: { ...rewritten.metadata, assetId } });
            migrated += 1;
        } catch (error) {
            failures.push(`${node.id}: ${error instanceof Error ? error.message : "本地媒体补传失败"}`);
            next.push(node);
        }
    }
    return { nodes: migrated ? next : [...nodes], migrated, failures };
}