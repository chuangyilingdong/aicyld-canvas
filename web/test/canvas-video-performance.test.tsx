import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AssetMediaPreview } from "@/components/asset-media-preview";
import { bindCanvasViewportVideoPause, CanvasNodeVideoPlayer } from "@/components/canvas/canvas-node-video-player";
import { applyCanvasLiveViewport } from "@/lib/canvas/canvas-live-viewport";
import type { Asset } from "@/stores/use-asset-store";

const originals = new Map<string, PropertyDescriptor | undefined>();
function stubGlobal(key: string, value: unknown) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

afterEach(() => {
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
});

test("canvas video card uses the lightweight native player", () => {
    const html = renderToStaticMarkup(
        <CanvasNodeVideoPlayer src="https://media.example/clip.mp4" mimeType="video/mp4;codecs=avc1" title="镜头 01" hasAudio={false} autoPlay>
            <span>字幕</span>
        </CanvasNodeVideoPlayer>,
    );
    expect(html).toContain('data-canvas-video-surface="native"');
    expect(html).toContain('data-no-audio="true"');
    expect(html).toContain("<video");
    expect(html).toContain('type="video/mp4"');
    expect(html).not.toContain("vds-");
    expect(html).not.toContain("backdrop-blur");
});

test("asset cards render an available cover before they mount a video decoder", () => {
    const asset = {
        id: "video-cover",
        kind: "video",
        title: "封面视频",
        coverUrl: "https://media.example/cover.jpg",
        tags: [],
        createdAt: "2026-11-21T00:00:00Z",
        updatedAt: "2026-11-21T00:00:00Z",
        data: {
            url: "https://media.example/clip.mp4",
            storageKey: "resource:video-cover",
            width: 1280,
            height: 720,
            bytes: 1024,
            mimeType: "video/mp4",
        },
    } satisfies Asset;
    const html = renderToStaticMarkup(<AssetMediaPreview asset={asset} alt="封面视频" hoverPlayDelayMs={300} />);
    expect(html).toContain("<img");
    expect(html).toContain("cover.jpg");
    expect(html).not.toContain("<video");
});

test("viewport zoom pauses active video decode and resumes only playback paused by the gesture", () => {
    let notifyMutation: (() => void) | undefined;
    stubGlobal("MutationObserver", class {
        constructor(callback: () => void) { notifyMutation = callback; }
        observe() {}
        disconnect() {}
    });
    const viewport = { dataset: {} as Record<string, string> };
    const root = { closest: (selector: string) => selector === "[data-canvas-viewport]" ? viewport : null } as unknown as HTMLElement;
    class FakeVideo extends EventTarget {
        paused = false;
        ended = false;
        pauseCalls = 0;
        playCalls = 0;
        pause() { this.paused = true; this.pauseCalls += 1; }
        async play() { this.paused = false; this.playCalls += 1; this.dispatchEvent(new Event("play")); }
    }
    const video = new FakeVideo();
    const cleanup = bindCanvasViewportVideoPause(root, video as unknown as HTMLVideoElement);

    viewport.dataset.canvasViewportInteracting = "true";
    notifyMutation?.();
    expect(video.paused).toBe(false);

    viewport.dataset.canvasViewportZooming = "true";
    notifyMutation?.();
    expect(video.paused).toBe(true);

    delete viewport.dataset.canvasViewportZooming;
    delete viewport.dataset.canvasViewportInteracting;
    notifyMutation?.();
    expect(video.paused).toBe(false);

    video.pause();
    viewport.dataset.canvasViewportZooming = "true";
    notifyMutation?.();
    delete viewport.dataset.canvasViewportZooming;
    notifyMutation?.();
    expect(video.paused).toBe(true);
    cleanup();
});

test("zoom gestures update inverse scale without repeatedly relaying out screen-space controls", () => {
    class FakeNode extends EventTarget {}
    class FakeElement extends FakeNode {}
    stubGlobal("Node", FakeNode);
    stubGlobal("Element", FakeElement);
    stubGlobal("MutationObserver", class {
        constructor(_callback: () => void) {}
        observe() {}
        disconnect() {}
    });
    const headerProps = new Map<string, string>();
    const header = Object.assign(new FakeElement(), {
        matches: () => true,
        querySelectorAll: () => [],
        style: {
            getPropertyValue: (name: string) => headerProps.get(name) || "",
            setProperty: (name: string, value: string) => headerProps.set(name, value),
        },
    });
    const containerProps = new Map<string, string>();
    const dataset: Record<string, string> = {};
    const world = { style: { transform: "", transformOrigin: "" } };
    const container = Object.assign(new FakeNode(), {
        dataset,
        style: {
            getPropertyValue: (name: string) => containerProps.get(name) || "",
            setProperty: (name: string, value: string) => containerProps.set(name, value),
        },
        matches: () => false,
        querySelector: (selector: string) => selector === "[data-canvas-world-layer]" ? world : null,
        querySelectorAll: () => [header],
    });

    applyCanvasLiveViewport(container as unknown as HTMLDivElement, { x: 0, y: 0, k: 1 }, false);
    expect(headerProps.get("--canvas-live-scale")).toBe("1");
    dataset.canvasViewportInteracting = "true";
    dataset.canvasViewportZooming = "true";
    applyCanvasLiveViewport(container as unknown as HTMLDivElement, { x: 0, y: 0, k: 0.5 }, false);
    expect(headerProps.get("--canvas-live-scale")).toBe("1");
    expect(headerProps.get("--canvas-live-inverse-scale")).toBe("2");

    delete dataset.canvasViewportInteracting;
    delete dataset.canvasViewportZooming;
    applyCanvasLiveViewport(container as unknown as HTMLDivElement, { x: 0, y: 0, k: 0.5 }, false);
    expect(headerProps.get("--canvas-live-scale")).toBe("0.5");
});
