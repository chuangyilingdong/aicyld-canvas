import type { ImageAdvancedParameter } from "@/lib/model-capabilities-image";

export function parseImageAdvancedValues(value?: string): Record<string, string> {
    try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key, String(item ?? "")]));
    } catch {
        return {};
    }
}

export function imageAdvancedProviderOptions(value: string | undefined, options: ImageAdvancedParameter[]) {
    const stored = parseImageAdvancedValues(value);
    const result: Record<string, string | number | boolean> = {};
    for (const option of options) {
        const raw = stored[option.key];
        if (raw === undefined || raw.trim() === "") continue;
        if (option.type === "number") {
            const number = Number(raw);
            if (!Number.isFinite(number)) continue;
            const min = option.min ?? Number.NEGATIVE_INFINITY;
            const max = option.max ?? Number.POSITIVE_INFINITY;
            if (number < min || number > max) continue;
            result[option.key] = number;
        } else if (option.type === "boolean") {
            if (raw === "true" || raw === "false") result[option.key] = raw === "true";
        } else if (!option.values?.length || option.values.includes(raw)) {
            result[option.key] = raw;
        }
    }
    return result;
}
