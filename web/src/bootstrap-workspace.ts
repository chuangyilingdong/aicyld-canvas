import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import { bootstrapDesktopRuntime } from "@/services/desktop-runtime";
import { isSignInRequiredError } from "@/services/api/request";
import { primeWorkspaceBootstrap } from "@/services/api/workspace";

export async function startApplication() {
    await bootstrapDesktopRuntime();
    try {
        // Resolve identity before importing the canvas store, project hydration
        // and route chunks. A missing/expired hosted session now redirects from
        // a small startup bundle instead of downloading the full editor first.
        await primeWorkspaceBootstrap();
    } catch (error) {
        if (isSignInRequiredError(error)) return;
        throw error;
    }
    const [
        { hydrateLocalCanvasProjectsFromBackend },
        { useCanvasStore },
        { bootstrapAppearance },
    ] = await Promise.all([
        import("@/services/local-workspace-repository"),
        import("@/stores/canvas/use-canvas-store"),
        import("@/services/appearance-bootstrap"),
    ]);
    // 浏览器缓存晚于后端读入完成时，会用旧连接数组盖掉刚合并的画布。
    await useCanvasStore.persist.rehydrate();
    await hydrateLocalCanvasProjectsFromBackend();
    await bootstrapAppearance().catch(() => console.warn("外观初始化未完成，继续打开工作区"));
    await import("./application");
}
