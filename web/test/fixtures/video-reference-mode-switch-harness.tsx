import { useState } from "react";
import { createRoot } from "react-dom/client";

import { VideoReferenceModeSwitch } from "@/components/canvas/canvas-node-reference-shelf";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveVideoReferenceModeState } from "@/lib/canvas/video-reference-mode";
import type { CanvasNodeMetadata } from "@/types/canvas";

function Harness() {
    const [metadata, setMetadata] = useState<CanvasNodeMetadata>({ videoEditOperation: "reference_to_video" });
    const state = resolveVideoReferenceModeState({
        metadata,
        references: [{ nodeId: "img-1", kind: "image", label: "图片1", title: "首帧", active: true }],
        framesSupported: true,
        referenceVideoSupported: true,
        endFrameSupported: true,
    });
    return (
        <div
            style={{ width: 420, padding: 24, background: canvasThemes.dark.canvas.background }}
            onMouseDown={() => { (window as any).parentMouseDown = true; }}
        >
            <output data-testid="operation">{metadata.videoEditOperation}</output>
            <VideoReferenceModeSwitch state={state} theme={canvasThemes.dark} onChange={(patch) => setMetadata((current) => ({ ...current, ...patch }))} />
        </div>
    );
}

createRoot(document.getElementById("root")!).render(<Harness />);
