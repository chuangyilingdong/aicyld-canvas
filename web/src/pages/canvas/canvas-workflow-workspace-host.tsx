import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CanvasWorkflowsHandle, CanvasWorkflowWorkspaceProps } from "./canvas-workflow-workspace";

const loadCanvasWorkflowWorkspace = () => import("./canvas-workflow-workspace");
const LazyCanvasWorkflowWorkspace = lazy(() => loadCanvasWorkflowWorkspace().then((module) => ({ default: module.CanvasWorkflowWorkspace })));

type PendingCommand = "openLibrary" | "toggleLibrary" | "saveSelection";

export const CanvasWorkflowWorkspaceHost = forwardRef<CanvasWorkflowsHandle, CanvasWorkflowWorkspaceProps>(function CanvasWorkflowWorkspaceHost(props, ref) {
    const [mounted, setMounted] = useState(false);
    const innerRef = useRef<CanvasWorkflowsHandle | null>(null);
    const pending = useRef<PendingCommand[]>([]);

    const flush = useCallback(() => {
        while (innerRef.current && pending.current.length) {
            const command = pending.current.shift();
            if (command) innerRef.current[command]();
        }
    }, []);

    const attach = useCallback((instance: CanvasWorkflowsHandle | null) => {
        innerRef.current = instance;
        if (instance) flush();
    }, [flush]);

    const request = useCallback((command: PendingCommand) => {
        if (innerRef.current) {
            innerRef.current[command]();
            return;
        }
        pending.current.push(command);
        setMounted(true);
    }, []);

    useImperativeHandle(ref, () => ({
        openLibrary: () => request("openLibrary"),
        toggleLibrary: () => request("toggleLibrary"),
        closeLibrary: () => innerRef.current?.closeLibrary(),
        saveSelection: () => request("saveSelection"),
    }), [request]);

    useEffect(() => {
        let active = true;
        const timer = window.setTimeout(() => {
            void loadCanvasWorkflowWorkspace().then(() => {
                if (active) setMounted(true);
            });
        }, 1200);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, []);

    if (!mounted) return null;
    return (
        <Suspense fallback={null}>
            <LazyCanvasWorkflowWorkspace {...props} ref={attach} />
        </Suspense>
    );
});
