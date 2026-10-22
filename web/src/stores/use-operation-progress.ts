import { nanoid } from "nanoid";
import { create } from "zustand";

import { createTransferSampler, type CanvasOperationTarget, type OperationProgress } from "@/lib/operation-progress";
import { subscribeUserScope } from "@/lib/user-scope";
import { captureUserScope, userScopeMatches, type CapturedUserScope } from "@/lib/user-scope-guard";

type Entry = OperationProgress & { owner: CapturedUserScope };
type ProgressStore = { entries: Record<string, Entry>; remove: (id: string) => void };

export const useOperationProgress = create<ProgressStore>((set) => ({
    entries: {},
    remove: (id) =>
        set((state) => {
            const entries = { ...state.entries };
            delete entries[id];
            return { entries };
        }),
}));

// These are transient observations and must never cross accounts or projects.
subscribeUserScope(() => useOperationProgress.setState({ entries: {} }));

export function startOperation(
    title: string,
    options: { detail?: string; totalBytes?: number; totalFiles?: number; owner?: CapturedUserScope; target?: CanvasOperationTarget } = {},
) {
    const id = nanoid();
    const owner = options.owner ?? captureUserScope();
    const startedAt = Date.now();
    const sample = createTransferSampler(startedAt);
    let finished = false;
    let lastReport = 0;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;

    const update = (patch: Partial<OperationProgress>) => {
        if (finished || !userScopeMatches(owner)) return;
        useOperationProgress.setState((state) => {
            const previous = state.entries[id];
            if (!previous) return state;
            return { entries: { ...state.entries, [id]: { ...previous, ...patch, updatedAt: patch.updatedAt ?? Date.now() } } };
        });
    };

    if (userScopeMatches(owner)) {
        useOperationProgress.setState((state) => ({
            entries: {
                ...state.entries,
                [id]: {
                    id,
                    owner,
                    title,
                    detail: options.detail || "正在准备文件",
                    phase: "preparing",
                    totalBytes: options.totalBytes,
                    totalFiles: options.totalFiles,
                    startedAt,
                    updatedAt: startedAt,
                    target: options.target,
                },
            },
        }));
    }

    const settle = (phase: "done" | "error", detail: string) => {
        if (finished) return;
        update({ phase, detail, bytesPerSecond: 0 });
        finished = true;
        dismissTimer = setTimeout(() => useOperationProgress.getState().remove(id), 5000);
        if (dismissTimer && typeof dismissTimer === "object" && "unref" in dismissTimer) dismissTimer.unref();
    };

    return {
        update,
        retarget: (target: CanvasOperationTarget) => update({ target }),
        progress: (loaded: number, total?: number, detail?: string) => {
            const now = Date.now();
            const next = sample(loaded, total);
            const complete = total !== undefined && total > 0 && loaded >= total;
            if (!complete && now - lastReport < 100) return;
            lastReport = now;
            update({
                ...next,
                phase: complete ? "processing" : "transferring",
                detail: detail || (complete ? "文件已传输，正在确认与保存" : "正在传输文件"),
            });
        },
        done: (detail = "处理完成") => settle("done", detail),
        fail: (detail = "处理没有完成，请重试") => settle("error", detail),
        dismiss: () => {
            finished = true;
            if (dismissTimer) clearTimeout(dismissTimer);
            useOperationProgress.getState().remove(id);
        },
    };
}
