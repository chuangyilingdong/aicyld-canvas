import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button } from "antd";

import {
    appUpdateBlockReason,
    appUpdateCheckDelayMs,
    beginAppUpdateReloadAttempt,
    currentAppBuildId,
    fetchAppRelease,
    isNewAppRelease,
    type AppReleaseManifest,
} from "@/services/app-update";

const FIRST_UPDATE_CHECK_DELAY_MS = 15_000;
const MIN_FOREGROUND_CHECK_GAP_MS = 60_000;
const PENDING_SAFETY_RECHECK_MS = 2_000;

function reloadPage() {
    window.location.reload();
}

export function AppUpdateController() {
    const { modal, notification } = App.useApp();
    const [pendingRelease, setPendingRelease] = useState<AppReleaseManifest | null>(null);
    const [blockReason, setBlockReason] = useState("");
    const [autoReloadSuppressed, setAutoReloadSuppressed] = useState(false);
    const checkingRef = useRef(false);
    const lastCheckAtRef = useRef(0);
    const pendingBuildRef = useRef("");
    const manualReloadRef = useRef(false);

    const checkForUpdate = useCallback(async () => {
        if (import.meta.env.DEV || checkingRef.current) return;
        const now = Date.now();
        if (now - lastCheckAtRef.current < MIN_FOREGROUND_CHECK_GAP_MS) return;
        checkingRef.current = true;
        lastCheckAtRef.current = now;
        try {
            const release = await fetchAppRelease();
            if (!isNewAppRelease(currentAppBuildId(), release)) {
                setPendingRelease(null);
                return;
            }
            setPendingRelease((current) => current?.buildId === release.buildId ? current : release);
        } catch {
            // A release probe must never interrupt editing or surface network noise.
        } finally {
            checkingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (import.meta.env.DEV) return;
        let cancelled = false;
        let intervalTimer: ReturnType<typeof setTimeout> | null = null;
        const firstTimer = setTimeout(() => {
            void checkForUpdate();
            const schedule = () => {
                intervalTimer = setTimeout(async () => {
                    await checkForUpdate();
                    if (!cancelled) schedule();
                }, appUpdateCheckDelayMs());
            };
            schedule();
        }, FIRST_UPDATE_CHECK_DELAY_MS);
        const onFocus = () => { void checkForUpdate(); };
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") void checkForUpdate();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            cancelled = true;
            clearTimeout(firstTimer);
            if (intervalTimer) clearTimeout(intervalTimer);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [checkForUpdate]);

    useEffect(() => {
        if (!pendingRelease) {
            pendingBuildRef.current = "";
            setBlockReason("");
            setAutoReloadSuppressed(false);
            return;
        }
        if (pendingBuildRef.current !== pendingRelease.buildId) {
            pendingBuildRef.current = pendingRelease.buildId;
            setAutoReloadSuppressed(false);
        }
        let cancelled = false;
        const evaluate = async () => {
            const reason = await appUpdateBlockReason();
            if (cancelled) return;
            setBlockReason(reason);
            if (reason || document.visibilityState !== "hidden" || manualReloadRef.current) return;
            if (!beginAppUpdateReloadAttempt(pendingRelease.buildId)) {
                setAutoReloadSuppressed(true);
                return;
            }
            reloadPage();
        };
        void evaluate();
        const timer = setInterval(() => { void evaluate(); }, PENDING_SAFETY_RECHECK_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") void evaluate();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [pendingRelease]);

    useEffect(() => {
        if (!pendingRelease) return;
        const description = autoReloadSuppressed
            ? "自动更新没有完成，请点击立即更新。"
            : blockReason
                ? `${blockReason}，完成后会自动更新。`
                : "切换到后台后会自动更新；也可以现在立即更新。";
        notification.open({
            key: `app-update-${pendingRelease.buildId}`,
            message: "新版本已准备好",
            description,
            duration: 0,
            placement: "bottomRight",
            btn: (
                <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                        modal.confirm({
                            title: "立即更新到新版本？",
                            content: blockReason
                                ? `${blockReason}。现在更新可能中断当前操作。`
                                : "页面会自动刷新，当前会话和已保存的画布不会丢失。",
                            okText: "立即更新",
                            cancelText: "稍后",
                            onOk: () => {
                                manualReloadRef.current = true;
                                beginAppUpdateReloadAttempt(pendingRelease.buildId);
                                reloadPage();
                            },
                        });
                    }}
                >
                    立即更新
                </Button>
            ),
        });
    }, [autoReloadSuppressed, blockReason, modal, notification, pendingRelease]);

    return null;
}
