/** 托管构建（hb.aicyld.com.cn）：默认即托管模式，bootstrap 载荷再确认一次。 */
const HOSTED_BUILD = import.meta.env.VITE_CANVAS_HOSTED === "1";

export type WorkspaceProfile = "local" | "hosted";

let capabilitySnapshot: WorkspaceCapabilityContract | null = null;
let workspaceProfile: WorkspaceProfile = HOSTED_BUILD ? "hosted" : "local";

export type WorkspaceCapabilityContract = {
    contractVersion: number;
    profile: WorkspaceProfile;
    capabilities: {
        localAssets: boolean;
        providerCalls: boolean;
    };
};

/** 本地优先工作区（桌面/单机）与主站托管工作区走不同的存储与厂商边界。 */
export function isLocalWorkspaceMode() {
    return workspaceProfile !== "hosted";
}

export function isHostedBuild() {
    return HOSTED_BUILD;
}

/** 服务端 bootstrap 返回的 profile 是最终权威；运行时以它为准。 */
export function setWorkspaceProfile(profile: WorkspaceProfile) {
    workspaceProfile = profile === "hosted" ? "hosted" : "local";
}

export function workspaceProfileName(): WorkspaceProfile {
    return workspaceProfile;
}

/**
 * Single capability projection for UI boundaries. Keep the hosted profile
 * available, but make the local-first contract explicit instead of repeating
 * storageMode/username checks throughout pages.
 */
export type WorkspaceCapabilities = { local: boolean; localAssets: boolean; providerCalls: boolean };

export function workspaceCapabilities(): WorkspaceCapabilities {
    return {
        local: isLocalWorkspaceMode(),
        localAssets: capabilitySnapshot?.capabilities.localAssets ?? true,
        providerCalls: capabilitySnapshot?.capabilities.providerCalls ?? true,
    };
}

export function setWorkspaceCapabilitySnapshot(snapshot: WorkspaceCapabilityContract | null) {
    capabilitySnapshot = snapshot;
}

export function resetWorkspaceMode() {
    capabilitySnapshot = null;
    workspaceProfile = HOSTED_BUILD ? "hosted" : "local";
}
