import { useEffect, useRef } from "react";

import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

type CanvasPerformanceTelemetryInput = {
    canvasId: string;
    nodeCount: number;
    connectionCount: number;
    domNodeCount: number;
    lodNodeCount: number;
    lodActive: boolean;
    interacting: boolean;
};

export function canvasFramePercentile(samples: readonly number[], percentile: number) {
    if (samples.length === 0) return 0;
    const ordered = [...samples].sort((left, right) => left - right);
    const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * percentile) - 1));
    return ordered[index];
}

export function useCanvasPerformanceTelemetry(input: CanvasPerformanceTelemetryInput) {
    const latestRef = useRef(input);
    latestRef.current = input;
    const longTasksRef = useRef<number[]>([]);

    useEffect(() => {
        const start = performance.now();
        let first = 0;
        let second = 0;
        first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                const latest = latestRef.current;
                recordDiagnosticEvent({
                    level: "info",
                    category: "runtime",
                    code: "canvas_first_usable",
                    message: `画布首次可用 nodes=${latest.nodeCount} connections=${latest.connectionCount} dom=${latest.domNodeCount}`,
                    canvasId: latest.canvasId,
                    durationMs: performance.now() - start,
                });
            });
        });
        return () => {
            cancelAnimationFrame(first);
            if (second) cancelAnimationFrame(second);
        };
    }, [input.canvasId]);

    useEffect(() => {
        if (typeof PerformanceObserver === "undefined") return;
        let observer: PerformanceObserver | null = null;
        try {
            observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (longTasksRef.current.length >= 120) break;
                    longTasksRef.current.push(entry.duration);
                }
            });
            observer.observe({ type: "longtask", buffered: true });
        } catch {
            observer = null;
        }
        return () => observer?.disconnect();
    }, []);

    useEffect(() => {
        if (!input.interacting) return;
        const startedAt = performance.now();
        const intervals: number[] = [];
        let previous = 0;
        let frame = 0;
        let stopped = false;
        const tick = (now: number) => {
            if (stopped) return;
            if (previous > 0) intervals.push(now - previous);
            previous = now;
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => {
            stopped = true;
            cancelAnimationFrame(frame);
            const durationMs = performance.now() - startedAt;
            if (durationMs < 150 || intervals.length < 4) return;
            const latest = latestRef.current;
            const p95FrameMs = canvasFramePercentile(intervals, 0.95);
            const slowFrames = intervals.filter((value) => value > 34).length;
            const longTasks = longTasksRef.current.splice(0);
            recordDiagnosticEvent({
                level: p95FrameMs > 50 ? "warning" : "info",
                category: "runtime",
                code: "canvas_interaction_performance",
                message: `画布手势 frameP95=${p95FrameMs.toFixed(1)}ms slowFrames=${slowFrames}/${intervals.length} longTasks=${longTasks.length} lod=${latest.lodActive ? "on" : "off"} dom=${latest.domNodeCount} lodNodes=${latest.lodNodeCount} nodes=${latest.nodeCount}`,
                canvasId: latest.canvasId,
                durationMs,
            });
        };
    }, [input.interacting]);

    useEffect(() => () => {
        if (longTasksRef.current.length === 0) return;
        const samples = longTasksRef.current.splice(0);
        recordDiagnosticEvent({
            level: "info",
            category: "runtime",
            code: "canvas_long_task_summary",
            message: `画布长任务 count=${samples.length} p95=${canvasFramePercentile(samples, 0.95).toFixed(1)}ms`,
            canvasId: latestRef.current.canvasId,
            durationMs: samples.reduce((sum, value) => sum + value, 0),
        });
    }, []);
}
