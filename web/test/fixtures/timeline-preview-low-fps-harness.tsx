import { createRoot } from "react-dom/client";
import { useState } from "react";

import { CanvasTimelinePreview } from "@/components/canvas/canvas-timeline-preview";
import { canvasThemes } from "@/lib/canvas-theme";
import type { TimelineClip } from "@/types/timeline";

const clip: TimelineClip = {
    id: "low-fps-video",
    kind: "video",
    nodeId: "low-fps-node",
    trackId: "video-track",
    startMs: 0,
    durationMs: 4000,
    sourceStartMs: 0,
    sourceDurationMs: 4000,
    title: "Low FPS",
    directMedia: { id: "low-fps-media", kind: "video", title: "Low FPS", url: "/low-fps.mp4", durationMs: 4000 },
};

function Harness() {
    const [playheadMs, setPlayheadMs] = useState(0);
    const [playing, setPlaying] = useState(false);
    (window as any).timelineLowFpsFixture = {
        snapshot: () => {
            const video = document.querySelector("video") as HTMLVideoElement | null;
            return {
                playheadMs,
                playing,
                video: video ? { currentTime: video.currentTime, paused: video.paused, ended: video.ended, readyState: video.readyState } : null,
            };
        },
    };
    return <CanvasTimelinePreview clips={[clip]} nodes={[]} playheadMs={playheadMs} playing={playing} theme={Object.values(canvasThemes)[0]} onTogglePlay={() => setPlaying(value => !value)} onPlayheadChange={setPlayheadMs} />;
}

createRoot(document.getElementById("root")!).render(<Harness />);
