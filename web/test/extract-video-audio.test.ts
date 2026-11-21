import { describe, expect, test } from "bun:test";

import {
    assertExtractableAudioBuffer,
    buildExtractedAudioFileName,
    decodeAudioBufferFromVideoBlob,
    encodeAudioBufferToWav,
    extractVideoAudioToCanvasNode,
    NO_VIDEO_AUDIO_TRACK_MESSAGE,
    type DecodedAudioLike,
} from "@/lib/canvas/extract-video-audio";
import type { RemoteResource, ResourceUploadMeta } from "@/services/api/resources";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function makeSineBuffer(amplitude = 0.5, durationSeconds = 0.25): DecodedAudioLike {
    const sampleRate = 16000;
    const length = Math.round(sampleRate * durationSeconds);
    const channel = new Float32Array(length);
    for (let index = 0; index < length; index += 1) channel[index] = amplitude * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    return {
        numberOfChannels: 1,
        length,
        sampleRate,
        getChannelData: () => channel,
    };
}

describe("extract video audio", () => {
    test("encodes PCM WAV and rejects missing or silent audio", async () => {
        const wav = encodeAudioBufferToWav(makeSineBuffer());
        expect(wav.type).toBe("audio/wav");
        const view = new DataView(await wav.arrayBuffer());
        expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(16000);
        expect(() => assertExtractableAudioBuffer(makeSineBuffer(0))).toThrow(NO_VIDEO_AUDIO_TRACK_MESSAGE);

        await expect(decodeAudioBufferFromVideoBlob(new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }), {
            createAudioContext: () => ({
                decodeAudioData: async () => { throw new DOMException("bad media", "EncodingError"); },
            }),
        })).rejects.toThrow(NO_VIDEO_AUDIO_TRACK_MESSAGE);
    });

    test("creates one right-hand audio node without generating a muted video node", async () => {
        const source: CanvasNodeData = {
            id: "video-source",
            type: CanvasNodeType.Video,
            title: "角色参考.mp4",
            position: { x: 200, y: 300 },
            width: 360,
            height: 202,
            metadata: { content: "https://example.test/source.mp4", storageKey: "resource:video-1" },
        };
        const uploads: Array<{ file: File; meta?: ResourceUploadMeta }> = [];
        const result = await extractVideoAudioToCanvasNode(source, [source], {
            useLocalStore: () => false,
            resolveVideoBlob: async () => new Blob([new Uint8Array([0, 1, 2, 3])], { type: "video/mp4" }),
            createAudioContext: () => ({
                decodeAudioData: async () => makeSineBuffer(0.5, 1.5),
            }),
            uploadAudioResource: async (file, _kind, meta) => {
                uploads.push({ file, meta });
                return {
                    id: "audio-resource",
                    kind: "audio",
                    mimeType: "audio/wav",
                    size: file.size,
                    durationMs: meta?.durationMs,
                    publicUrl: "",
                    createdAt: new Date().toISOString(),
                } as RemoteResource;
            },
        });

        expect(buildExtractedAudioFileName("角色参考.mp4")).toBe("角色参考-audio.wav");
        expect(uploads).toHaveLength(1);
        expect(result.audioNode.type).toBe(CanvasNodeType.Audio);
        expect(result.audioNode.metadata?.audioExtractSourceNodeId).toBe(source.id);
        expect(result.audioNode.metadata?.storageKey).toBe("resource:audio-resource");
        expect(result.audioNode.metadata?.durationMs).toBe(1500);
        expect(result.connection.fromNodeId).toBe(source.id);
        expect(result.connection.toNodeId).toBe(result.audioNode.id);
    });
});
