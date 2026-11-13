import type { ExternalAssetPickerReference } from "@/lib/plugins/plugin-types";
import type { Asset } from "@/stores/use-asset-store";

export type InsertableAsset = Extract<Asset, { kind: "text" | "image" | "video" | "audio" }>;

export type InsertAssetPayload =
    | { kind: "text"; content: string; title: string; assetId?: string }
    | { kind: "image"; dataUrl: string; title: string; url?: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number; hasAudio?: boolean; bytes?: number; mimeType?: string; assetId?: string }
    | { kind: "audio"; url: string; title: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; assetId?: string }
    | {
          kind: "character";
          title: string;
          assetId: string;
          versionId: string;
          prompt: string;
          aliases: string[];
          definition: Record<string, unknown>;
          coverUrl?: string;
          visualStatus: string;
          voiceStatus: string;
          voiceName?: string;
          voiceProfile?: { name: string; provider: string; language: string; timbre: string };
          voiceInstructions?: string;
      };

export function localAssetToInsertPayload(asset: InsertableAsset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
    if (asset.kind === "video")
        return {
            kind: "video",
            url: asset.data.url,
            storageKey: asset.data.storageKey,
            title: asset.title,
            width: asset.data.width,
            height: asset.data.height,
            durationMs: asset.data.durationMs,
            hasAudio: asset.data.hasAudio,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
            assetId: asset.id,
        };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType, assetId: asset.id };
}

export function externalAssetToInsertPayload(reference: ExternalAssetPickerReference): InsertAssetPayload {
    const item = reference.item;
    const url = item.fileUrl || "";
    if (!url) throw new Error(`“${item.title}”暂时无法读取，请先在 Eagle 中确认文件可用`);
    const assetId = `external:${reference.sourceId}:${item.id}`;
    if (item.kind === "image") return { kind: "image", dataUrl: url, url, title: item.title || "素材图片", width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "video") return { kind: "video", url, title: item.title, width: item.width, height: item.height, bytes: item.bytes, mimeType: item.mimeType, assetId };
    if (item.kind === "audio") return { kind: "audio", url, title: item.title, bytes: item.bytes, mimeType: item.mimeType, assetId };
    throw new Error(`“${item.title}”不是可插入画布的媒体文件`);
}
