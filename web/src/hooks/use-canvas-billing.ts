import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getCanvasBillingBalance } from "@/services/api/canvas-billing";

export const CANVAS_BILLING_BALANCE_QUERY_KEY = ["canvas-billing-balance"] as const;

export function useCanvasBillingBalance(options: { enabled?: boolean } = {}) {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: CANVAS_BILLING_BALANCE_QUERY_KEY,
        queryFn: getCanvasBillingBalance,
        enabled: options.enabled ?? true,
        staleTime: 5_000,
        refetchInterval: 10_000,
        refetchOnWindowFocus: true,
        retry: 1,
    });

    useEffect(() => {
        const refresh = () => void queryClient.invalidateQueries({ queryKey: CANVAS_BILLING_BALANCE_QUERY_KEY });
        window.addEventListener("canvas:task-created", refresh);
        window.addEventListener("canvas:task-updated", refresh);
        return () => {
            window.removeEventListener("canvas:task-created", refresh);
            window.removeEventListener("canvas:task-updated", refresh);
        };
    }, [queryClient]);

    return query;
}
