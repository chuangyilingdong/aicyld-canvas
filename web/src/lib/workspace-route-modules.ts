const workspaceRouteLoaders = {
    agents: () => import("@/pages/agents"),
    home: () => import("@/pages/home"),
    assets: () => import("@/pages/assets"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    projectDetail: () => import("@/pages/projects/detail"),
    skills: () => import("@/pages/skills"),
    smartFilm: () => import("@/pages/smart-film"),
    smartFilmBatchNew: () => import("@/pages/smart-film/batch-new"),
    smartFilmBatchList: () => import("@/pages/smart-film/batch-list"),
    smartFilmBatchDetail: () => import("@/pages/smart-film/batch-detail"),
};

export const loadAgentsPage = workspaceRouteLoaders.agents;
export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadHomePage = workspaceRouteLoaders.home;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;
export const loadSkillsPage = workspaceRouteLoaders.skills;
export const loadSmartFilmPage = workspaceRouteLoaders.smartFilm;
export const loadSmartFilmBatchNewPage = workspaceRouteLoaders.smartFilmBatchNew;
export const loadSmartFilmBatchListPage = workspaceRouteLoaders.smartFilmBatchList;
export const loadSmartFilmBatchDetailPage = workspaceRouteLoaders.smartFilmBatchDetail;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "home";
    if (slug === "projects" || slug === "project") {
        if (segments.length > 1) void workspaceRouteLoaders.projectDetail();
        else void workspaceRouteLoaders.canvas();
        return;
    }
    if (slug === "canvas") {
        if (segments.length > 1) void import("@/pages/canvas/project");
        else void workspaceRouteLoaders.canvas();
        return;
    }
    if (slug === "smart-film" && segments[1] === "batches") {
        if (segments[2] === "new") void workspaceRouteLoaders.smartFilmBatchNew();
        else if (segments[2]) void workspaceRouteLoaders.smartFilmBatchDetail();
        else void workspaceRouteLoaders.smartFilmBatchList();
        return;
    }
    const load = workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (load) void load();
}
