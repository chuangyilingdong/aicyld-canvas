import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocol } from "@/lib/model-protocols";
import { http } from "@/services/api/request";
import type { WorkspaceCapabilityContract } from "@/services/workspace-mode";
import type { AiConfig } from "@/stores/use-config-store";
import type { FeatureAvailability, LocalUser, RuntimeLimits } from "@/stores/use-user-store";

export type ModelCapabilityDraftInput = {
    capability?: string;
    category?: string;
    type?: string;
    protocol?: ModelProtocol | string;
    interfaceType?: ModelProtocol | string;
    model: string;
    baseUrl?: string;
    channelId?: string;
    videoCapabilitiesVersion?: string;
    capabilityConfig?: ModelCapabilityConfig;
};

export function normalizeModelCapabilityDraft(draft: ModelCapabilityDraftInput) {
    return http.post<ModelCapabilityConfig & { capabilityConfig?: ModelCapabilityConfig }>("/workspace/model-config/capability", draft);
}

export type LocalWorkspace = {
    id: string;
    name: string;
    owner: string;
    storage: string;
};

export type WorkspaceBootstrapPayload = {
    contractVersion: number;
    profile: "local" | "hosted";
    capabilities: WorkspaceCapabilityContract["capabilities"];
    user: LocalUser;
    workspace: LocalWorkspace;
    storageMode: "local" | "remote";
    runtimeLimits?: RuntimeLimits;
    features?: FeatureAvailability;
};

let workspaceBootstrapRequest: Promise<WorkspaceBootstrapPayload> | undefined;

export function getWorkspaceBootstrap() {
    workspaceBootstrapRequest ??= fetchWorkspaceBootstrap();
    return workspaceBootstrapRequest;
}

export function fetchWorkspaceBootstrap() {
    return http.get<WorkspaceBootstrapPayload>("/workspace/bootstrap");
}

/**
 * Validate the hosted session before importing the canvas route and stores.
 * The request is cached and reused by WorkspaceBootstrapHydrator, so this does
 * not add a second bootstrap call for authenticated users.
 */
export function primeWorkspaceBootstrap() {
    return getWorkspaceBootstrap();
}

export function getLocalModelConfig() {
	return http.get<LocalModelConfigPayload>("/workspace/model-config");
}

export type LocalModelConfigPayload = {
	config: AiConfig;
	revision: number;
	health: "ready" | "default" | "migrated" | "recovered";
	source: "builtin+local";
	featureModels?: Record<string, string>;
};

export function saveLocalModelConfig(config: AiConfig, expectedRevision: number) {
	return http.put<{ saved: boolean; revision: number }>("/workspace/model-config", { config, expectedRevision });
}
