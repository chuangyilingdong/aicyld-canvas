import { useState } from "react";
import { App, ConfigProvider } from "antd";
import { createRoot } from "react-dom/client";

import { CanvasNodeMediaViewer } from "@/components/canvas/canvas-node-media-viewer";
import { getAntThemeConfig } from "@/lib/app-theme";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

useConfigStore.setState({ config: defaultConfig, isAiConfigReady: true });

const image =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="816" height="1456"><rect width="816" height="1456" fill="#456"/></svg>');
const previousImage =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="816" height="1456"><rect width="816" height="1456" fill="#654"/></svg>');

const node: CanvasNodeData = {
    id: "viewer-node",
    type: CanvasNodeType.Image,
    title: "统一预览图片",
    width: 320,
    height: 180,
    position: { x: 0, y: 0 },
    metadata: {
        prompt: "统一的图片预览提示词",
        naturalWidth: 816,
        naturalHeight: 1456,
        size: "16:9",
        mimeType: "image/svg+xml",
        imageHistory: [{
            id: "previous",
            content: previousImage,
            prompt: "历史版本提示词",
            naturalWidth: 816,
            naturalHeight: 1456,
            size: "16:9",
            mimeType: "image/svg+xml",
        }],
    },
};

function Harness() {
    const [open, setOpen] = useState(true);
    const [infoNodeId, setInfoNodeId] = useState("");
    return (
        <main>
            <button type="button" onClick={() => setOpen(true)}>重新打开</button>
            <output data-testid="info-node">{infoNodeId}</output>
            {open ? (
                <CanvasNodeMediaViewer
                    node={node}
                    source={image}
                    onClose={() => setOpen(false)}
                    onOpenNodeInfo={(nodeId) => setInfoNodeId(nodeId)}
                />
            ) : null}
        </main>
    );
}

createRoot(document.getElementById("root")!).render(
    <ConfigProvider theme={getAntThemeConfig(false)}>
        <App>
            <Harness />
        </App>
    </ConfigProvider>,
);
