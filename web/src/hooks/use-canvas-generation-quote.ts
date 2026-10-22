import { useQuery } from "@tanstack/react-query";

import { quoteGenerationTask, type GenerationBillingQuote } from "@/services/api/task-billing";
import type { CreateTaskInput } from "@/services/api/task-center";

export function useCanvasGenerationQuote(input: CreateTaskInput | null) {
    const requestKey = input ? JSON.stringify(input) : "";
    const query = useQuery<GenerationBillingQuote>({
        queryKey: ["canvas-generation-quote", requestKey],
        queryFn: ({ signal }) => quoteGenerationTask(input!, { signal }),
        enabled: Boolean(input),
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: 1,
    });
    return {
        quote: query.data,
        loading: Boolean(input) && query.isFetching,
        error: query.error,
        refetch: query.refetch,
    };
}
