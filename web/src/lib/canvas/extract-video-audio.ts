import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { audioMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { mediaResultMetadata } from "@/lib/canvas/canvas-node-semantics";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { videoFrameFetchCredentials } from "@/lib/canvas/canvas-video-frame";
import { getActiveUserScope } from "@/lib/user-scope";
import {
    getResourceBlob,
    getResourcePlaybackBlob,
    resourceFileUrl,
    resourceIdFromStorageKey,
    resourceStorageKey,
    uploadResourceFile,
    type RemoteResource,
    type ResourceUploadMeta,
} from "@/services/api/resources";
import { getMediaBlob, resolveMediaUrl, type UploadedFile } from "@/services/file-storage";
import { saveLocalMedia } from "@/services/local-media-repository";
import { primeResourceBlobCache } from "@/services/resource-blob-cache";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export const NO_VIDEO_AUDIO_TRACK_MESSAGE = "当前视频不包含可提取的音轨";

const DEFAULT_MAX_WAV_SAMPLE_RATE = 24000;
const FALLBACK_LONG_WAV_SAMPLE_RATE = 16000;
const DEFAULT_MAX_WAV_BYTES = 24 * 1024 * 1024;
const SILENT_RMS_FLOOR = 1e-6;

export type DecodedAudioLike = {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    getChannelData: (channel: number) => Float32Array;
};

type AudioDecoderContextLike = {
    decodeAudioData: (audioData: ArrayBuffer) => Promise<DecodedAudioLike>;
    close?: () => Promise<void> | void;
};

export type ExtractVideoAudioDeps = {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    resolveVideoBlob?: (node: CanvasNodeData, signal?: AbortSignal) => Promise<Blob>;
    createAudioContext?: () => AudioDecoderContextLike;
    uploadAudioResource?: (file: File, kind: "audio", meta?: ResourceUploadMeta) => Promise<RemoteResource>;
    useLocalStore?: () => boolean;
};

export function assertExtractableAudioBuffer(buffer: DecodedAudioLike | null | undefined): asserts buffer is DecodedAudioLike {
    if (
        !buffer
        || !Number.isFinite(buffer.numberOfChannels)
        || buffer.numberOfChannels <= 0
        || !Number.isFinite(buffer.length)
        || buffer.length <= 0
        || !Number.isFinite(buffer.sampleRate)
        || buffer.sampleRate <= 0
    ) {
        throw new Error(NO_VIDEO_AUDIO_TRACK_MESSAGE);
    }

    const channelCount = Math.min(2, buffer.numberOfChannels);
    const stride = Math.max(1, Math.floor(buffer.length / 65536));
    let sumSquares = 0;
    let sampledCount = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < data.length; index += stride) {
            const sample = data[index] || 0;
            sumSquares += sample * sample;
            sampledCount += 1;
        }
    }
    const rms = sampledCount > 0 ? Math.sqrt(sumSquares / sampledCount) : 0;
    if (!Number.isFinite(rms) || rms <= SILENT_RMS_FLOOR) throw new Error(NO_VIDEO_AUDIO_TRACK_MESSAGE);
}

export function encodeAudioBufferToWav(
    buffer: DecodedAudioLike,
    options?: { maxSampleRate?: number; maxBytes?: number },
): Blob {
    assertExtractableAudioBuffer(buffer);
    const maxSampleRate = Math.max(8000, Math.round(options?.maxSampleRate ?? DEFAULT_MAX_WAV_SAMPLE_RATE));
    const maxBytes = Math.max(64 * 1024, Math.round(options?.maxBytes ?? DEFAULT_MAX_WAV_BYTES));
    const durationSeconds = buffer.length / buffer.sampleRate;

    let channelCount = Math.min(2, buffer.numberOfChannels);
    let targetSampleRate = Math.min(Math.round(buffer.sampleRate), maxSampleRate);
    if (Math.ceil(durationSeconds * targetSampleRate) * channelCount * 2 > maxBytes) {
        targetSampleRate = Math.min(targetSampleRate, FALLBACK_LONG_WAV_SAMPLE_RATE);
    }
    if (Math.ceil(durationSeconds * targetSampleRate) * channelCount * 2 > maxBytes) channelCount = 1;

    const channels: Float32Array[] = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
        const sourceChannel = buffer.getChannelData(channel);
        channels.push(targetSampleRate === Math.round(buffer.sampleRate)
            ? sourceChannel
            : downsampleChannel(sourceChannel, buffer.sampleRate, targetSampleRate));
    }
    const frameCount = channels[0]?.length ?? 0;
    if (!frameCount) throw new Error(NO_VIDEO_AUDIO_TRACK_MESSAGE);

    const blockAlign = channelCount * 2;
    const byteRate = targetSampleRate * blockAlign;
    const dataByteLength = frameCount * blockAlign;
    const wavBuffer = new ArrayBuffer(44 + dataByteLength);
    const view = new DataView(wavBuffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, 36 + dataByteLength, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, dataByteLength, true);

    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
            const raw = Math.max(-1, Math.min(1, channels[channel][frame] || 0));
            view.setInt16(offset, raw < 0 ? Math.round(raw * 0x8000) : Math.round(raw * 0x7fff), true);
            offset += 2;
        }
    }
    return new Blob([wavBuffer], { type: "audio/wav" });
}

export function buildExtractedAudioFileName(videoTitle?: string): string {
    const stripped = (videoTitle || "")
        .trim()
        .replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, "")
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 64);
    return `${stripped || "video"}-audio.wav`;
}

export async function resolveVideoNodeBinaryBlob(
    node: CanvasNodeData,
    options?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<Blob> {
    if (node.type !== CanvasNodeType.Video) throw new Error("仅视频节点支持提取音频");
    const signal = options?.signal;
    signal?.throwIfAborted();

    const content = node.metadata?.content?.trim() || "";
    const storageKey = node.metadata?.storageKey?.trim() || "";
    if (!content && !storageKey) throw new Error("视频节点为空，无法提取音频");

    if (storageKey) {
        const cached = await getMediaBlob(storageKey).catch(() => null);
        if (cached?.size) return cached;
        if (resourceIdFromStorageKey(storageKey)) {
            const directBlob = await getResourceBlob(storageKey, { signal });
            if (directBlob?.size) return directBlob;
            const playbackBlob = await getResourcePlaybackBlob(storageKey, { signal }).catch(() => null);
            if (playbackBlob?.size) return playbackBlob;
        }
    }

    const resolvedUrl = await resolveMediaUrl(storageKey, content);
    signal?.throwIfAborted();
    if (!resolvedUrl) throw new Error("无法读取视频资源地址");
    const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(resolvedUrl, {
        credentials: videoFrameFetchCredentials(resolvedUrl),
        signal,
    });
    if (!response.ok) throw new Error(`视频资源请求失败（${response.status}）`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("读取到的视频资源为空");
    return blob;
}

export async function decodeAudioBufferFromVideoBlob(
    blob: Blob,
    options?: { signal?: AbortSignal; createAudioContext?: () => AudioDecoderContextLike },
): Promise<DecodedAudioLike> {
    options?.signal?.throwIfAborted();
    const rawBuffer = await blob.arrayBuffer();
    options?.signal?.throwIfAborted();
    if (!rawBuffer.byteLength) throw new Error(NO_VIDEO_AUDIO_TRACK_MESSAGE);
    const context = options?.createAudioContext ? options.createAudioContext() : createBrowserAudioContext();
    try {
        let decoded: DecodedAudioLike;
        try {
            decoded = await context.decodeAudioData(rawBuffer.slice(0));
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new Error(NO_VIDEO_AUDIO_TRACK_MESSAGE);
        }
        options?.signal?.throwIfAborted();
        assertExtractableAudioBuffer(decoded);
        return decoded;
    } finally {
        try {
            await context.close?.();
        } catch {
            // The decoder may already have closed after a browser-level media error.
        }
    }
}

export async function extractVideoAudioToCanvasNode(
    node: CanvasNodeData,
    existingNodes: CanvasNodeData[],
    deps?: ExtractVideoAudioDeps,
): Promise<{ audioNode: CanvasNodeData; connection: CanvasConnection; durationMs: number }> {
    const signal = deps?.signal;
    signal?.throwIfAborted();
    const videoBlob = deps?.resolveVideoBlob
        ? await deps.resolveVideoBlob(node, signal)
        : await resolveVideoNodeBinaryBlob(node, { signal, fetchImpl: deps?.fetchImpl });
    const decoded = await decodeAudioBufferFromVideoBlob(videoBlob, {
        signal,
        createAudioContext: deps?.createAudioContext,
    });
    const durationMs = Math.max(1, Math.round((decoded.length / decoded.sampleRate) * 1000));
    const wavFile = new File([encodeAudioBufferToWav(decoded)], buildExtractedAudioFileName(node.title), { type: "audio/wav" });
    signal?.throwIfAborted();
    const uploaded = await persistExtractedWavFile(wavFile, durationMs, node.id, deps);
    signal?.throwIfAborted();

    const audioSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
    const existingCount = existingNodes.filter((item) => item.metadata?.audioExtractSourceNodeId === node.id).length;
    const audioNode = createCanvasNode(
        CanvasNodeType.Audio,
        {
            x: node.position.x + node.width + 96 + audioSpec.width / 2,
            y: node.position.y + existingCount * (audioSpec.height + 32) + audioSpec.height / 2,
        },
        mediaResultMetadata("derived", {
            ...audioMetadata(uploaded),
            prompt: `从「${node.title || "视频"}」提取的纯音频`,
            status: "success",
            audioExtractSourceNodeId: node.id,
            audioExtractStartMs: 0,
            audioExtractEndMs: durationMs,
        }),
    );
    audioNode.title = `${node.title || "视频"} · 音频`;
    return {
        audioNode,
        connection: { id: nanoid(), fromNodeId: node.id, toNodeId: audioNode.id },
        durationMs,
    };
}

async function persistExtractedWavFile(
    wavFile: File,
    durationMs: number,
    sourceNodeId: string,
    deps?: ExtractVideoAudioDeps,
): Promise<UploadedFile> {
    const useLocal = deps?.useLocalStore ? deps.useLocalStore() : usesBrowserLocalResourceStore();
    if (useLocal && !deps?.uploadAudioResource) {
        const localKey = `audio:${getActiveUserScope()}:${nanoid()}`;
        const objectUrl = URL.createObjectURL(wavFile);
        try {
            await saveLocalMedia(localKey, wavFile, objectUrl);
        } catch (error) {
            URL.revokeObjectURL(objectUrl);
            throw error;
        }
        return { url: objectUrl, storageKey: localKey, bytes: wavFile.size, mimeType: "audio/wav", durationMs };
    }

    const uploader = deps?.uploadAudioResource ?? ((file: File, kind: "audio", meta?: ResourceUploadMeta) => uploadResourceFile(file, kind, meta));
    const resource = await uploader(wavFile, "audio", {
        fileName: wavFile.name,
        durationMs,
        idempotencyKey: `video-audio-wav:${getActiveUserScope()}:${sourceNodeId}:${nanoid()}`,
    });
    const storageKey = resourceStorageKey(resource.id);
    await primeResourceBlobCache(storageKey, wavFile).catch(() => undefined);
    return {
        url: resource.publicUrl || resourceFileUrl(resource.id),
        storageKey,
        bytes: resource.size || wavFile.size,
        mimeType: resource.mimeType || "audio/wav",
        durationMs: resource.durationMs || durationMs,
    };
}

function createBrowserAudioContext(): AudioDecoderContextLike {
    const AudioContextCtor = globalThis.AudioContext
        || (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) throw new Error("当前运行环境不支持音频解码");
    return new AudioContextCtor();
}

function downsampleChannel(source: Float32Array, sourceRate: number, targetRate: number): Float32Array {
    if (targetRate >= sourceRate) return source;
    const ratio = sourceRate / targetRate;
    const targetLength = Math.max(1, Math.floor(source.length / ratio));
    const output = new Float32Array(targetLength);
    for (let index = 0; index < targetLength; index += 1) {
        const start = Math.floor(index * ratio);
        const end = Math.min(source.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
        let sum = 0;
        for (let cursor = start; cursor < end; cursor += 1) sum += source[cursor] || 0;
        output[index] = sum / (end - start);
    }
    return output;
}

function writeAscii(view: DataView, offset: number, text: string) {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}
