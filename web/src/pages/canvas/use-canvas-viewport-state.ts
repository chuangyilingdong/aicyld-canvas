import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ViewportTransform } from "@/types/canvas";

export function useCanvasViewportState(projectId: string, projectLoaded: boolean, savedViewport?: ViewportTransform) {
    const containerRef = useRef<HTMLDivElement>(null);
    const didInitialCenter = useRef(false);
    const [viewport, setCommittedViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const viewportRef = useRef(viewport);
    const [virtualizationViewport, setVirtualizationViewport] = useState<ViewportTransform | null>(null);
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const setViewport = useCallback<Dispatch<SetStateAction<ViewportTransform>>>((next) => {
        setVirtualizationViewport(null);
        setCommittedViewport(next);
    }, []);
    useLayoutEffect(() => { viewportRef.current = viewport; }, [viewport]);
    useEffect(() => { didInitialCenter.current = false; }, [projectId]);
    useEffect(() => {
        if (!projectLoaded || !containerRef.current) return;
        const element = containerRef.current;
        const updateSize = () => {
            const rect = element.getBoundingClientRect();
            setSize(current => current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height });
            if (didInitialCenter.current) return;
            didInitialCenter.current = true;
            const current = viewportRef.current;
            if (current.x === 0 && current.y === 0 && current.k === 1) {
                const saved = savedViewport;
                const restored = saved
                    && Number.isFinite(saved.x)
                    && Number.isFinite(saved.y)
                    && Number.isFinite(saved.k)
                    && saved.k > 0
                    && !(saved.x === 0 && saved.y === 0 && saved.k === 1)
                    ? { x: saved.x, y: saved.y, k: saved.k }
                    : null;
                const next = restored || { x: rect.width / 2, y: rect.height / 2, k: 1 };
                viewportRef.current = next;
                setViewport(next);
            }
        };
        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, [projectLoaded, savedViewport, setViewport]);
    return { containerRef, viewport, viewportRef, setViewport, virtualizationViewport, setVirtualizationViewport, size };
}

export function useCanvasDockedViewport(width: number, viewport: Pick<ReturnType<typeof useCanvasViewportState>, "viewportRef" | "setViewport">) {
    const previousWidth = useRef(width);
    const { viewportRef, setViewport } = viewport;
    useEffect(() => {
        const delta = width - previousWidth.current;
        previousWidth.current = width;
        if (!delta) return;
        const next = { ...viewportRef.current, x: viewportRef.current.x - delta / 2 };
        viewportRef.current = next;
        setViewport(next);
    }, [width, viewportRef, setViewport]);
}
