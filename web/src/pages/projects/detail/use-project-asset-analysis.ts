import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getProjectSmartFilmRun } from "@/services/api/smart-film-batches";

export function useProjectAssetAnalysis(projectId: string, enabled: boolean) {
    const queryClient = useQueryClient();
    const runQuery = useQuery({
        queryKey: ["project", projectId, "smart-film-run"],
        queryFn: ({ signal }) => getProjectSmartFilmRun(projectId, signal).then((result) => result.run),
        enabled,
        retry: false,
        refetchInterval: (query) => {
            const status = query.state.data?.assetStatus;
            return status && ["pending", "waiting", "queued", "running"].includes(status) ? 2000 : false;
        },
    });
    const run = runQuery.data;
    const running = Boolean(run && ["pending", "waiting", "queued", "running"].includes(run.assetStatus));
    const failed = run?.assetStatus === "needs_attention" || run?.failedStep === "assets";
    const observedStatusRef = useRef("");
    useEffect(() => {
        const status = run?.assetStatus || "";
        if (!status || status === observedStatusRef.current) return;
        observedStatusRef.current = status;
        if (["ready", "confirmed", "needs_attention"].includes(status)) {
            void Promise.all([
                queryClient.invalidateQueries({ queryKey: ["project", projectId, "asset-candidates"] }),
                queryClient.invalidateQueries({ queryKey: ["project", projectId, "assets"] }),
            ]);
        }
    }, [projectId, queryClient, run?.assetStatus]);
    return { running, failed };
}
