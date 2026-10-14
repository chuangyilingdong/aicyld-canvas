import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { appPathname } from "@/lib/app-routing";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { applyUserSession, localWorkspaceConfig } from "@/lib/user-session";
import { getWorkspaceBootstrap, type WorkspaceBootstrapPayload } from "@/services/api/workspace";
import { isSignInRequiredError } from "@/services/api/request";
import { isHostedBuild, isLocalWorkspaceMode } from "@/services/workspace-mode";
import { commitModelConfig, flushModelConfig, hydrateModelConfig } from "@/services/model-config-repository";
import { applyPlatformFeatureModels } from "@/lib/canvas/feature-models";
import { normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function WorkspaceBootstrapHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const modelConfigReady = useRef(false);
    const [restoreStatus, setRestoreStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        let cancelled = false;
        const loadWorkspace = () => {
            const bootstrap = getWorkspaceBootstrap();
            const timeout = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("本地工作区启动超时")), 15_000));
            return Promise.race([bootstrap, timeout]);
        };
        void initializeWorkspaceState({
            loadWorkspace,
            createLocalWorkspace: createLocalWorkspacePayload,
            applySession: applyUserSession,
            restoreModelConfig: hydrateLocalModelConfig,
        })
            .then(() => {
                if (cancelled) return;
                modelConfigReady.current = true;
                setRestoreStatus("ready");
                preloadWorkspaceRoute(appPathname());
            })
            .catch(() => {
                if (cancelled) return;
                // The browser cache deliberately has no credentials. If the
                // canonical file could not be read, never autosave that cache
                // over the existing workspace when the backend comes back.
                modelConfigReady.current = false;
                useUserStore.getState().setHydrated(true);
                setRestoreStatus("error");
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let ready = false;
        const unsubscribe = useConfigStore.subscribe((state) => {
            // 托管形态：模型渠道由平台统一维护，浏览器不再回写服务端配置。
            if (!isLocalWorkspaceMode()) return;
            if (!shouldSaveLocalModelConfig({ subscriptionReady: ready, modelConfigReady: modelConfigReady.current, channelCount: state.config.channels.length })) return;
            void commitModelConfig(state.config);
        });
        const flush = () => { void flushModelConfig(); };
        window.addEventListener("pagehide", flush);
        const markReady = () => { ready = true; };
        if (modelConfigReady.current) markReady();
        else window.setTimeout(markReady, 0);
        return () => {
            unsubscribe();
            window.removeEventListener("pagehide", flush);
            void flushModelConfig();
        };
    }, []);

    if (restoreStatus === "error") return <WorkspaceErrorState title="工作区暂时无法加载" description="项目或模型配置未能完成读取。原有配置不会被覆盖，请重新加载后再试。" onRetry={() => window.location.reload()} />;
    return hydrated && restoreStatus === "ready" ? children : <FullScreenLoader label="正在准备本地工作区" detail="加载项目、画布与模型配置" />;
}

export async function initializeWorkspaceState<T>({
    loadWorkspace,
    createLocalWorkspace,
    applySession,
    restoreModelConfig,
}: {
    loadWorkspace: () => Promise<T>;
    createLocalWorkspace: () => T;
    applySession: (payload: T) => Promise<void>;
    restoreModelConfig: () => Promise<void>;
}) {
    try {
        try {
            await applySession(await loadWorkspace());
        } catch (error) {
            // 托管部署（hb.aicyld.com.cn）不能静默降级成"空白的本地工作区"：
            // 会话失效交给 401 跳转处理，其它失败由外层显示错误态并允许重试。
            if (isSignInRequiredError(error) || isHostedBuild()) throw error;
            // Keep the desktop usable while the embedded backend is still
            // starting. There is no remote/account fallback in a local build.
            await applySession(createLocalWorkspace());
        }
    } finally {
        // The provider snapshot is an independent, canonical desktop file.
        // Browser persistence may be corrupt or unavailable; that must never
        // prevent configured channels and credentials from being restored.
        await restoreModelConfig();
    }
}

export function shouldSaveLocalModelConfig({ subscriptionReady, modelConfigReady, channelCount }: { subscriptionReady: boolean; modelConfigReady: boolean; channelCount: number }) {
    return subscriptionReady && modelConfigReady && channelCount > 0;
}

async function hydrateLocalModelConfig() {
    const result = await hydrateModelConfig();
    const normalized = normalizeConfigSnapshot({ config: result.config }).config;
    // 托管形态：服务端下发的渠道（含平台统一渠道）必须原样保留，不做本地化过滤。
    // 托管形态：平台内置「功能 → 模型」作为各模式的默认模型（用户仍可在节点上改）。
    const normalizedConfig = isLocalWorkspaceMode()
        ? localWorkspaceConfig(normalized)
        : applyPlatformFeatureModels(normalized);
    useConfigStore.getState().replaceConfig(normalizedConfig);
    if (isLocalWorkspaceMode() && shouldPersistHydratedModelConfig(result.health)) await commitModelConfig(normalizedConfig);
}

export function shouldPersistHydratedModelConfig(health: string) {
    return health === "migrated" || health === "recovered";
}

function createLocalWorkspacePayload(): WorkspaceBootstrapPayload {
    return {
        contractVersion: 1,
        profile: "local",
        capabilities: {
            localAssets: true,
            providerCalls: true,
        },
        user: { id: "local", username: "local", displayName: "本地工作区", role: "user", status: "active", createdAt: "", updatedAt: "" },
        workspace: { id: "local", name: "本地工作区", owner: "local", storage: "sqlite" },
        storageMode: "local",
        features: { shortDramaEnabled: true, taskCenterEnabled: true, customChannelsEnabled: true, frontendModelsEnabled: false, pluginCenterEnabled: true, systemPluginsVisibleToUsers: true },
    };
}
