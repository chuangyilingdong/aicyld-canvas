import { describe, expect, test } from "bun:test";

import { resolveEditorTimeline } from "../src/lib/timeline/editor-delivery-seed";
import { buildDeliveryTimeline, type DeliveryTimelineInput } from "../src/lib/timeline/shot-sequence-timeline";
import type { TimelineProject } from "../src/types/timeline";

const DELIVERY_ID = "unit-delivery";

function deliveryInput(): DeliveryTimelineInput {
    return {
        shots: [{
            id: "shot-1",
            projectId: "project-1",
            unitId: DELIVERY_ID,
            title: "开场",
            description: "",
            position: 0,
            durationMs: 5200,
            status: "ready",
            currentRevisionId: "revision-1",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
        }],
        shotRevisions: [{
            id: "revision-1",
            shotId: "shot-1",
            version: 1,
            plotDescription: "",
            action: "",
            dialogue: "时间线字幕",
            shotSize: "",
            cameraAngle: "",
            cameraMovement: "",
            durationMs: 5200,
            imagePrompt: "",
            videoPrompt: "",
            negativePrompt: "",
            continuityNotes: "",
            actionBeatsJson: "[]",
            createdAt: "2026-01-01T00:00:00Z",
        }],
        shotArtifacts: [{
            id: "video-1",
            shotId: "shot-1",
            projectId: "project-1",
            unitId: DELIVERY_ID,
            type: "video",
            version: 1,
            resourceId: "resource-video-1",
            status: "ready",
            selected: true,
            metadataJson: JSON.stringify({ durationSeconds: 5.2 }),
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
        }],
    };
}

function storedTimeline(): TimelineProject {
    return {
        version: 2,
        tracks: [{ id: "video-1", kind: "video", label: "手工时间线", order: 0 }],
        clips: [{
            id: "manual-clip",
            kind: "video",
            nodeId: "manual-node",
            trackId: "video-1",
            startMs: 0,
            durationMs: 1200,
            directMedia: { id: "manual", kind: "video", title: "手工素材", storageKey: "resource:manual" },
        }],
        durationMs: 1200,
    };
}

describe("delivery timeline output", () => {
    test("inherits project aspect ratio instead of falling back to landscape", () => {
        expect(buildDeliveryTimeline(deliveryInput(), DELIVERY_ID, { aspectRatio: "9:16" }).timeline.output?.width).toBe(720);
        expect(buildDeliveryTimeline(deliveryInput(), DELIVERY_ID, { aspectRatio: "9:16" }).timeline.output?.height).toBe(1280);
        expect(buildDeliveryTimeline(deliveryInput(), DELIVERY_ID, { aspectRatio: "16:9" }).timeline.output).toMatchObject({ width: 1280, height: 720 });
        expect(buildDeliveryTimeline(deliveryInput(), DELIVERY_ID, { aspectRatio: "1:1" }).timeline.output).toMatchObject({ width: 720, height: 720 });
    });
});

describe("resolveEditorTimeline", () => {
    test("keeps a valid local edit instead of rebuilding from delivery artifacts", () => {
        const stored = storedTimeline();
        const resolved = resolveEditorTimeline({
            storedRaw: JSON.stringify(stored),
            delivery: deliveryInput(),
            unitId: DELIVERY_ID,
            aspectRatio: "9:16",
        });
        expect(resolved.source).toBe("stored");
        expect(resolved.timeline.clips[0].id).toBe("manual-clip");
    });

    test("first delivery visit seeds video, subtitle and project output", () => {
        const resolved = resolveEditorTimeline({
            storedRaw: null,
            delivery: deliveryInput(),
            unitId: DELIVERY_ID,
            aspectRatio: "9:16",
        });
        expect(resolved.source).toBe("delivery");
        expect(resolved.timeline.clips.map((clip) => clip.kind)).toContain("subtitle");
        expect(resolved.timeline.output).toMatchObject({ width: 720, height: 1280, burnSubtitles: true });
    });

    test("invalid local data falls back to delivery and keeps the parse error", () => {
        const resolved = resolveEditorTimeline({
            storedRaw: "{broken",
            delivery: deliveryInput(),
            unitId: DELIVERY_ID,
            aspectRatio: "9:16",
        });
        expect(resolved.source).toBe("delivery");
        expect(resolved.storedError).toBeDefined();
    });

    test("incomplete delivery data stays empty", () => {
        const input = deliveryInput();
        const resolved = resolveEditorTimeline({
            storedRaw: null,
            delivery: { ...input, shotArtifacts: [] },
            unitId: DELIVERY_ID,
            aspectRatio: "9:16",
        });
        expect(resolved.source).toBe("empty");
        expect(resolved.timeline.clips).toEqual([]);
    });
});
