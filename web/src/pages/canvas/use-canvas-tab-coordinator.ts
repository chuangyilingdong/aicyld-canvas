import { App } from "antd";
import { useEffect, useRef } from "react";

import { getActiveUserScope } from "@/lib/user-scope";

type CanvasTabMessage = {
    type: "hello" | "present";
    tabId: string;
    requestId: string;
};

function tabId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `canvas-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Warn when the same canvas is open in more than one browser tab. */
export function useCanvasTabCoordinator(projectId: string, enabled: boolean) {
    const { message } = App.useApp();
    const warnedRef = useRef(false);

    useEffect(() => {
        warnedRef.current = false;
        if (!enabled || !projectId || typeof BroadcastChannel === "undefined") return;
        const currentTabId = tabId();
        const requestId = tabId();
        let channel: BroadcastChannel | undefined;
        try {
            channel = new BroadcastChannel(`infinite-canvas:tab:${getActiveUserScope()}:${projectId}`);
        } catch {
            return;
        }
        channel.onmessage = (event: MessageEvent<CanvasTabMessage>) => {
            const data = event.data;
            if (!data || data.tabId === currentTabId) return;
            if (data.type === "hello") {
                channel?.postMessage({ type: "present", tabId: currentTabId, requestId: data.requestId } satisfies CanvasTabMessage);
                return;
            }
            if (data.type === "present" && data.requestId === requestId && !warnedRef.current) {
                warnedRef.current = true;
                message.warning({
                    key: `canvas-tab-${projectId}`,
                    content: "同一画布已在另一个标签页打开。保存会按标签页串行执行，建议只保留一个编辑页以避免版本冲突。",
                });
            }
        };
        channel.postMessage({ type: "hello", tabId: currentTabId, requestId } satisfies CanvasTabMessage);
        return () => {
            channel?.close();
        };
    }, [enabled, message, projectId]);
}
