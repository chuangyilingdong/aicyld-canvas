import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { quoteGenerationTask, type GenerationBillingQuote } from "@/services/api/task-billing";
import type { CreateTaskInput } from "@/services/api/task-center";

export function useCanvasGenerationQuote(input: CreateTaskInput | null) {
    const requestKey = input ? JSON.stringify(input) : "";
    const inputRef = useRef(input);
    inputRef.current = input;
    const [debouncedInput, setDebouncedInput] = useState<CreateTaskInput | null>(input);
    useEffect(() => {
        if (!inputRef.current) {
            setDebouncedInput(null);
            return;
        }
        const timer = window.setTimeout(() => setDebouncedInput(inputRef.current), 160);
        return () => window.clearTimeout(timer);
    }, [requestKey]);
    const debouncedKey = debouncedInput ? JSON.stringify(debouncedInput) : "";
    const debouncing = Boolean(input) && requestKey !== debouncedKey;
    const query = useQuery<GenerationBillingQuote>({
        queryKey: ["canvas-generation-quote", debouncedKey],
        queryFn: ({ signal }) => quoteGenerationTask(debouncedInput!, { signal }),
        enabled: Boolean(debouncedInput),
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: 1,
    });
    return {
        quote: query.data,
        loading: Boolean(input) && (debouncing || query.isFetching),
        error: query.error,
        refetch: query.refetch,
    };
}
