import { http } from "@/services/api/request";

export type ExternalGuardrailMode = "allow" | "propose_only";

export type ExternalAgentGuardrails = {
    mode: ExternalGuardrailMode;
    maxPerCallCny: number;
    dailyBudgetCny: number;
    todaySpentCny: number;
};

export type ExternalAgentGuardrailsInput = Omit<ExternalAgentGuardrails, "todaySpentCny">;

export function getExternalAgentGuardrails(signal?: AbortSignal) {
    return http.get<ExternalAgentGuardrails>("/agent-clients/guardrails", { signal });
}

export function updateExternalAgentGuardrails(input: ExternalAgentGuardrailsInput) {
    return http.put<ExternalAgentGuardrails>("/agent-clients/guardrails", input);
}
