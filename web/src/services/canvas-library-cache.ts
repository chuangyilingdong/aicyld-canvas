import { appQueryClient } from "@/lib/query-client";

/**
 * 画布列表（/canvas）与首页「最近项目」在托管模式下读的是服务端查询
 * （`canvas-library` / `beeftv-home-canvases`）。任何写操作落库成功后都要显式失效，
 * 否则服务端已经变了、界面还是旧的：删除后卡片留在屏幕上、移动/重命名看着没生效。
 * 注意 queryClient 的 staleTime 是 30s 且关闭了 refetchOnWindowFocus，靠自动刷新不可靠。
 */
export function invalidateCanvasLibraryQueries() {
    void appQueryClient.invalidateQueries({ queryKey: ["canvas-library"] });
    void appQueryClient.invalidateQueries({ queryKey: ["beeftv-home-canvases"] });
}