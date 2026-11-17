import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { getCanvasHydrationHealth,subscribeCanvasHydrationHealth } from "@/services/canvas-hydration-health";
import { useNavigate, useSearchParams } from "react-router";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Input, Modal } from "antd";
import { Select } from "@/components/ui/base/select";
import { Archive, Clapperboard, Download, FolderPlus, Image as ImageIcon, MoreHorizontal, Pencil, Plus, Settings2, Trash2, Upload } from "lucide-react";

import { CollectionGrid, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { ExpandableSearch } from "@/components/layout/expandable-search";
import { WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";

import { CanvasFolderCard } from "@/components/canvas/canvas-folder-card";
import { CanvasDeleteConfirmation } from "@/components/canvas/canvas-delete-confirmation";
import { ProjectLibraryCover } from "@/components/canvas/project-library-cover";
import { RecycleBinDialog } from "@/components/canvas/recycle-bin-dialog";
import { LibraryCardShell } from "@/components/canvas/library-card-shell";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { canvasExportProgressLabel, exportCanvasProjectsByIds, type CanvasExportProgress } from "@/lib/canvas/canvas-export";
import { restoreCanvasArchive } from "@/lib/canvas/canvas-archive-restore";
import { createCanvasLibraryFolder, deleteCanvasLibraryFolder, hydrateCanvasLibraryFolders, persistCanvasFolderCover, renameCanvasLibraryFolder } from "@/lib/canvas/canvas-folder-storage";
import { isWailsNativeShell } from "@/services/desktop-media-save";
import { loadCanvasProjectForEditing, saveRemoteUserDataNow } from "@/services/local-workspace-sync";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { usesBrowserLocalResourceStore } from "@/services/workspace-resource-storage";
import { beginLocalCanvasProject, deleteLocalCanvasProjects, hydrateLocalCanvasProjectsFromBackend, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { createWorkspaceCanvasProject } from "@/services/workspace-project-repository";
import { listWorkspaceCanvasProjectsPage, type CanvasLibrarySummary } from "@/services/api/workspace-data";
import { useUserStore } from "@/stores/use-user-store";
import { deleteProject, duplicateProject, listProjects, updateProject as updateProjectRecord, type ProjectSummary } from "@/services/api/projects";
import { projectSummaryStage } from "@/lib/project-workbench";
import { loadCanvasProjectPage } from "@/lib/workspace-route-modules";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { cn } from "@/lib/utils";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";
import { canvasIdsForWorkspaceProjects, canvasWorkspaceProjectId, listCanvasWorkspaceProjectCanvases, listCanvasWorkspaceProjectRoots, previewNodesForWorkspaceProject, resolveWorkspaceExportCanvasIds } from "@/lib/canvas/canvas-workspace-project";

const CanvasDeleteProjectsDialog = lazy(() => import("@/components/canvas/canvas-delete-projects-dialog").then((module) => ({ default: module.CanvasDeleteProjectsDialog })));

export default function CanvasPage() {
    const canvasHealth = useSyncExternalStore(subscribeCanvasHydrationHealth,getCanvasHydrationHealth);
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [keyword, setKeyword] = useState("");
    const sort = "updated" as "updated" | "name" | "nodes";
    const projectFilter = "all" as string;
    const [folderFilter, setFolderFilter] = useState("all");
    const [renamingStudioProject, setRenamingStudioProject] = useState<ProjectSummary["project"] | null>(null);
    const [studioProjectRenameValue, setStudioProjectRenameValue] = useState("");
    const [folderDialogOpen, setFolderDialogOpen] = useState(false);
    const [folderName, setFolderName] = useState("");
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
    const [deletingFolder, setDeletingFolder] = useState<{ id: string; name: string } | null>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [loadedProjectCount, setLoadedProjectCount] = useState(50);
    const [creationError, setCreationError] = useState(false);
    const focusBatchId = searchParams.get("batch") || "";
    const exportController = useRef<AbortController | null>(null);
    const [exportProgress, setExportProgress] = useState<CanvasExportProgress | null>(null);
    const [exportError, setExportError] = useState("");
    useEffect(() => () => exportController.current?.abort(), []);
    useEffect(() => {
        if (searchParams.get("smart") === "1") navigate("/smart-film/batches", { replace: true });
    }, [navigate, searchParams]);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const localProjects = useCanvasStore((state) => state.projects);
    const folders = useCanvasStore((state) => state.folders);
    const moveProjectsToFolder = useCanvasStore((state) => state.moveProjectsToFolder);
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    // The sync layer is the source of truth: it also recognizes the synthetic
    // local identity, which protects the library from stale session state after
    // a desktop reload or HMR cycle.
    // The default 灵动TV build is local-only even when a stale/embedded browser
    // session still contains a logged-in user. Cloud project APIs are opt-in via
    // the explicit hosted build flag, never inferred from login state.
    const remoteMode = import.meta.env.VITE_CANVAS_LOCAL_MODE === "false" && Boolean(userId) && !isLocalWorkspaceMode();
    useEffect(() => {
        if (!hydrated || !isLocalWorkspaceMode()) return;
        void hydrateLocalCanvasProjectsFromBackend();
        void hydrateCanvasLibraryFolders().catch((error) => {
            message.error(error instanceof Error ? error.message : "文件夹列表读取失败");
        });
    }, [hydrated, message]);
    const [debouncedKeyword, setDebouncedKeyword] = useState("");
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [keyword]);
    const libraryQuery = useInfiniteQuery({
        queryKey: ["canvas-library", userId, projectFilter, sort, debouncedKeyword],
        queryFn: ({ pageParam, signal }) => listWorkspaceCanvasProjectsPage({ page: pageParam, pageSize: 40, projectId: projectFilter, sort, query: debouncedKeyword, signal }),
        initialPageParam: 1,
        getNextPageParam: (last) => last.hasMore ? last.page + 1 : undefined,
        enabled: remoteMode && sessionHydrated,
    });
    const projects = useMemo<CanvasLibrarySummary[]>(() => remoteMode
        ? libraryQuery.data?.pages.flatMap((page) => page.projects) || []
        : listCanvasWorkspaceProjectRoots(localProjects).map((project) => ({ ...project, nodeCount: project.nodes.length, previewNodes: previewNodesForWorkspaceProject(localProjects, canvasWorkspaceProjectId(project)) })), [libraryQuery.data, localProjects, remoteMode]);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const deleteDialogOpen = useCanvasUiStore((state) => state.deleteProjectIds.length > 0);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const deleteSelectedProjects = () => {
        setDeleteIds(selectedCanvasIds);
    };
    const updateProject = useCanvasStore((state) => state.updateProject);
    const [historyOpen, setHistoryOpen] = useState(() => searchParams.get("history") === "all" || searchParams.get("history") === "deleted");
    const [associationOpen, setAssociationOpen] = useState(false);
    const [associationProjectId, setAssociationProjectId] = useState("");
    // 本地工作区的画布、文件夹与历史完全来自浏览器本地存储；项目关系查询只在远程工作区启用。
    const projectQuery = useQuery({ queryKey: ["projects", userId], queryFn: () => listProjects(), enabled: remoteMode && sessionHydrated });
    const studioProjects = useMemo(() => remoteMode ? projectQuery.data?.projects || [] : [], [projectQuery.data, remoteMode]);
    const visibleStudioProjects = useMemo(() => {
        if (folderFilter !== "all") return [];
        const query = debouncedKeyword.toLowerCase();
        return (focusBatchId ? studioProjects.filter(({ project }) => project.batchId === focusBatchId) : studioProjects)
            .filter(({ project }) => (projectFilter === "all" || projectFilter === project.id) && (!query || project.name.toLowerCase().includes(query)))
            .sort((left, right) => sort === "name" ? left.project.name.localeCompare(right.project.name, "zh-CN") : right.project.updatedAt.localeCompare(left.project.updatedAt));
    }, [debouncedKeyword, focusBatchId, folderFilter, projectFilter, studioProjects, sort]);
    const clearBatchFocus = () => {
        const next = new URLSearchParams(searchParams);
        next.delete("batch");
        setSearchParams(next, { replace: true });
    };
    const requestDeleteStudioProject = (item: ProjectSummary) => {
        modal.confirm({
            title: `删除项目「${item.project.name}」？`,
            content: "项目章节、画布关联和素材归属会一并移除，独立画布与素材库原始素材会保留。此操作不可撤销。",
            okText: "删除项目",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteProject(item.project.id);
                    await queryClient.invalidateQueries({ queryKey: ["projects"] });
                    message.success("项目已删除");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "项目删除失败");
                    throw error;
                }
            },
        });
    };
    const duplicateStudioProject = async (item: ProjectSummary) => {
        try {
            await duplicateProject(item.project.id);
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success("项目副本已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建项目副本失败");
        }
    };
    const renameStudioProject = useMutation({
        mutationFn: ({ projectId, name }: { projectId: string; name: string }) => updateProjectRecord(projectId, { name }),
        onSuccess: async (result) => {
            setRenamingStudioProject(null);
            setStudioProjectRenameValue("");
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["projects"] }),
                queryClient.invalidateQueries({ queryKey: ["project", result.project.id] }),
            ]);
            message.success("项目已重命名");
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目重命名失败"),
    });
    const toggleStudioProjectArchive = async (item: ProjectSummary) => {
        try {
            const nextStatus = item.project.status === "archived" ? "active" : "archived";
            await updateProjectRecord(item.project.id, { status: nextStatus });
            await queryClient.invalidateQueries({ queryKey: ["projects"] });
            message.success(nextStatus === "archived" ? "项目已归档" : "项目已恢复");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "项目状态更新失败");
        }
    };

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const handoffMode = mode === "handoff";
    const forwardedQuery = agentMode || handoffMode || searchParams.get("agent") === "1" ? `?${searchParams.toString()}` : "";
    const preloadProject = useCallback(() => {
        void loadCanvasProjectPage();
    }, []);
    const enterProject = useCallback(
        (id: string) => {
            preloadProject();
            navigate(`/canvas/${id}${forwardedQuery}`);
        },
        [forwardedQuery, navigate, preloadProject],
    );
    const createAndEnter = () => {
        setCreationError(false);
        const { id, saved } = beginLocalCanvasProject("未命名项目");
        void saved.then(() => {
            // Only enter after the desktop repository has accepted the new canvas.
            if (searchParams.get("stay") !== "1") enterProject(id);
        }).catch((error) => {
            setCreationError(true);
            message.error(error instanceof Error ? error.message : "创建项目失败，请重试");
        });
    };
    const duplicateCanvasProject = useCallback(async (project: CanvasLibrarySummary) => {
        if (!remoteMode) {
            const sourceCanvases = listCanvasWorkspaceProjectCanvases(localProjects, project.id);
            let copiedWorkspaceProjectId: string | undefined;
            for (const [index, source] of sourceCanvases.entries()) {
                const copy = await createWorkspaceCanvasProject(index === 0 ? `${project.title || "未命名项目"} 副本` : source.title, source.projectId, {
                    nodes: source.nodes,
                    connections: source.connections,
                    chatSessions: source.chatSessions,
                    activeChatId: source.activeChatId,
                }, copiedWorkspaceProjectId);
                copiedWorkspaceProjectId ||= copy.id;
            }
            if (!copiedWorkspaceProjectId) throw new Error("项目不存在");
            message.success(`项目副本已创建，共 ${sourceCanvases.length} 张画布`);
            enterProject(copiedWorkspaceProjectId);
            return;
        }
        const source = await loadCanvasProjectForEditing(project.id);
        if (!source) throw new Error("画布不存在");
        const copy = await createWorkspaceCanvasProject(`${source.title || project.title || "未命名项目"} 副本`, undefined, {
            nodes: source.nodes,
            connections: source.connections,
            chatSessions: source.chatSessions,
            activeChatId: source.activeChatId,
        });
        message.success("项目副本已创建");
        enterProject(copy.id);
    }, [enterProject, localProjects, message, remoteMode]);
    const filteredProjects = useMemo(() => {
        if (focusBatchId) return [];
        if (remoteMode) return projects;
        const query = keyword.trim().toLowerCase();
        // The root library represents uncategorized work alongside folder tiles.
        // Categorized projects must disappear from the root after being moved and
        // only reappear when their folder is opened.
        const scoped = projects.filter((project) => (projectFilter === "all" || (projectFilter === "independent" ? !project.projectId : project.projectId === projectFilter)) && (folderFilter === "all" ? !project.folderId : project.folderId === folderFilter));
        const values = query ? scoped.filter((project) => project.title.toLowerCase().includes(query)) : [...scoped];
        values.sort((a, b) => (sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : sort === "nodes" ? b.nodeCount - a.nodeCount : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
        return values;
    }, [focusBatchId, folderFilter, keyword, projectFilter, projects, remoteMode, sort]);
    const projectNames = useMemo(() => new Map((projectQuery.data?.projects || []).map(({ project }) => [project.id, project.name])), [projectQuery.data]);
    const visibleProjects = remoteMode ? filteredProjects : filteredProjects.slice(0, loadedProjectCount);
    const hasMore = remoteMode ? libraryQuery.hasNextPage : visibleProjects.length < filteredProjects.length;
    const selectedProjects = projects.filter((project) => selectedIds.includes(project.id));
    const selectedCanvasIds = remoteMode ? selectedIds : canvasIdsForWorkspaceProjects(localProjects, selectedIds);
    // Folder tiles belong to the root library only. Once a folder is opened,
    // the grid represents that folder's contents; rendering the active folder
    // tile again makes an empty folder look like it contains itself.
    const visibleFolders = folderFilter === "all" ? folders : [];
    const libraryFolders = focusBatchId ? [] : visibleFolders;
    const activeFolder = folderFilter === "all" ? undefined : folders.find((folder) => folder.id === folderFilter);
    const saveFolderRename = () => {
        const nextName = folderName.trim() || "未命名文件夹";
        const id = editingFolderId;
        setFolderName("");
        setEditingFolderId(null);
        setFolderDialogOpen(false);
        if (!id) return;
        void renameCanvasLibraryFolder(id, nextName).catch((error) => {
            message.error(error instanceof Error ? error.message : "文件夹没有保存成功");
        });
    };
    useEffect(() => {
        setLoadedProjectCount(50);
    }, [folderFilter, keyword, projectFilter, sort]);
    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry?.isIntersecting) return;
                if (remoteMode) {
                    if (!libraryQuery.isFetchingNextPage && !libraryQuery.isFetchNextPageError) void libraryQuery.fetchNextPage();
                } else setLoadedProjectCount((count) => Math.min(count + 50, filteredProjects.length));
            },
            { rootMargin: "600px" },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [filteredProjects.length, visibleProjects.length, hasMore, remoteMode, libraryQuery.fetchNextPage, libraryQuery.isFetchingNextPage, libraryQuery.isFetchNextPageError]);
    const associateSelected = async (nextProjectId = associationProjectId) => {
        const projectId = nextProjectId || undefined;
        try {
            for (const id of selectedIds) await loadCanvasProjectForEditing(id);
            selectedIds.forEach((id) => updateProject(id, { projectId }));
            if (remoteMode) await saveRemoteUserDataNow();
            message.success(projectId ? "已加入项目" : "已移出项目，画布仍保留");
            setAssociationOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? `画布关系保存失败：${error.message}` : "画布关系保存失败");
        }
    };
    const exportCanvasByIds = async (canvasIds: readonly string[], archiveTitle?: string) => {
        if (exportController.current || !canvasIds.length) return;
        const controller = new AbortController();
        exportController.current = controller;
        setExportError("");
        setExportProgress({ phase: "loading" });
        try {
            let skippedCount = 0;
            const saved = await exportCanvasProjectsByIds(
                canvasIds,
                (id) => loadCanvasProjectForEditing(id),
                {
                    archiveTitle: archiveTitle || `${brandName}画布-${canvasIds.length}个画布`,
                    folders,
                    allowMissingMedia: true,
                    signal: controller.signal,
                    onProgress: setExportProgress,
                    onSkipped: (count) => { skippedCount = count; },
                },
            );
            if (saved !== "cancelled") {
                if (skippedCount > 0) message.warning(`已导出备份，已自动跳过 ${skippedCount} 个缺失或无法读取的素材`);
                else if (saved === "saved" && isWailsNativeShell()) message.success("已保存到所选位置");
            }
        } catch (error) {
            if (controller.signal.aborted) {
                recordDiagnosticEvent({ category: "action", level: "info", code: "canvas_export_cancelled", message: "已取消画布导出" });
            } else {
                setExportError(error instanceof Error ? error.message : "导出失败，请重试");
                recordDiagnosticEvent({ category: "action", level: "error", code: "canvas_export_failed", message: "画布导出失败" });
            }
        } finally {
            exportController.current = null;
            setExportProgress(null);
        }
    };
    const exportSelected = () => exportCanvasByIds(remoteMode ? selectedIds : resolveWorkspaceExportCanvasIds(localProjects, selectedIds));
    const exportWorkspaceProject = (project: CanvasLibrarySummary) => {
        const ids = remoteMode ? [project.id] : resolveWorkspaceExportCanvasIds(localProjects, [project.id]);
        return exportCanvasByIds(ids, `${project.title || brandName}-${ids.length}个画布`);
    };
    const exportFolderProjects = (folder: { id: string; name: string }) => {
        const folderProjectIds = projects.filter((project) => project.folderId === folder.id).map((project) => project.id);
        const ids = remoteMode ? folderProjectIds : resolveWorkspaceExportCanvasIds(localProjects, folderProjectIds);
        if (!ids.length) {
            message.info("当前文件夹暂无可导出的项目");
            return Promise.resolve();
        }
        return exportCanvasByIds(ids, `${folder.name}-${ids.length}个画布`);
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        const hideLoading = message.loading({ content: "正在解压并准备导入画布...", duration: 0 });
        try {
            const result = await restoreCanvasArchive(file, {
                onProjectProgress: (projectId, progress) => {
                    useSyncProgressStore.getState().setProjectProgress(projectId, progress);
                },
            });
            hideLoading();
            message.success(result.storage === "backend"
                ? `已导入 ${result.count} 个画布`
                : `已导入 ${result.count} 个画布并保存到本地`);
        } catch (error) {
            hideLoading();
            console.error("导入画布失败", error);
            message.error(error instanceof Error ? `导入失败：${error.message}` : "导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        // Local desktop canvases do not depend on a browser login session. Waiting
        // for session hydration here can leave /projects?mode=new on the opening
        // screen forever after an app restart, even though the local store is
        // already ready. Hosted mode still waits for both session and library.
        if (!hydrated || (remoteMode && (!sessionHydrated || !libraryQuery.isSuccess)) || autoOpenRef.current || (mode !== "new" && mode !== "recent" && mode !== "handoff")) return;
        // A new local canvas can be created while older projects are still
        // hydrating. Waiting for every historical canvas leaves this route on
        // the loading screen when one large project or cache write is slow.
        if (!remoteMode && mode !== "new" && (canvasHealth.loading || canvasHealth.error)) return;
        autoOpenRef.current = true;
        if (mode === "recent" && projects[0]?.id) {
            enterProject(projects[0].id);
            return;
        }
        const { id, saved } = beginLocalCanvasProject("未命名项目");
        void saved.then(() => {
            enterProject(id);
        }).catch((error) => {
            setCreationError(true);
            message.error(error instanceof Error ? error.message : "创建项目失败，请重试");
        });
    }, [hydrated, message, mode, projects, remoteMode, sessionHydrated, libraryQuery.isSuccess, canvasHealth, enterProject]);

    if (!creationError && !libraryQuery.isError && !(canvasHealth.error && !remoteMode) && (mode === "new" || mode === "recent" || mode === "handoff")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <WorkspacePage className="studio-collection-page lib-tv-project-page">
            <PageHeader
                title={activeFolder?.name || "项目库"}
                leading={activeFolder ? <button type="button" className="libtv-project-breadcrumb-button" onClick={() => setFolderFilter("all")}>项目库 /</button> : undefined}
                actions={(
                    <div className="libtv-project-actions">
                    <Button icon={<Clapperboard />} onClick={() => navigate("/smart-film/batches")}>多剧本成片</Button>
                    <ExpandableSearch value={keyword} placeholder="搜索项目" onChange={setKeyword} />
                    <Button icon={<Upload />} disabled={!hydrated} onClick={() => inputRef.current?.click()}>导入画布</Button>
                    <Button icon={<Trash2 />} onClick={() => setHistoryOpen(true)}>回收站</Button>
                    <Button icon={<FolderPlus />} disabled={!hydrated} onClick={() => {
                        void createCanvasLibraryFolder("未命名文件夹").catch((error) => {
                            message.error(error instanceof Error ? error.message : "文件夹没有保存成功");
                        });
                    }}>新建文件夹</Button>
                    </div>
                )}
            />

            <div className="collection-content">
                {selectedIds.length || exportProgress ? (
                    <div className="collection-selection-bar">
                        <strong className="mr-auto font-medium">{exportProgress ? "正在导出项目" : `已选 ${selectedIds.length} 个对象`}</strong>
                        {remoteMode ? <>
                            <Button
                                size="small"
                                disabled={!hydrated || projectQuery.isLoading}
                                onClick={() => {
                                    setAssociationProjectId(selectedProjects[0]?.projectId || "");
                                    setAssociationOpen(true);
                                }}
                            >
                                加入项目
                            </Button>
                            {selectedProjects.some((project) => project.projectId) ? (
                                <Button
                                    size="small"
                                    disabled={!hydrated}
                                    onClick={() => {
                                        setAssociationProjectId("");
                                        void associateSelected("");
                                    }}
                                >
                                    移出项目
                                </Button>
                            ) : null}
                        </> : null}
                        <Button size="small" aria-label="导出" disabled={!hydrated} loading={Boolean(exportProgress)} icon={<Download className="size-3.5" />} onClick={() => void exportSelected()}>
                            导出
                        </Button>
                        {exportProgress ? <>
                            <span className="text-sm text-foreground/65" role="status" aria-live="polite">{canvasExportProgressLabel(exportProgress)}</span>
                            <Button size="small" disabled={exportProgress.phase === "saving"} onClick={() => exportController.current?.abort()}>取消导出</Button>
                        </> : null}
                        <Button size="small" danger disabled={!hydrated || Boolean(exportProgress)} onClick={deleteSelectedProjects}>
                            删除
                        </Button>
                    </div>
                ) : null}

                {exportError ? <p role="alert" className="mb-4 whitespace-pre-wrap break-words text-sm text-destructive">{exportError}</p> : null}
                {focusBatchId && visibleStudioProjects.length ? (
                    <section className="project-batch-focus" aria-label="刚刚创建的项目">
                        <div>
                            <strong role="status" aria-live="polite">刚刚创建的 {visibleStudioProjects.length} 个项目已置顶</strong>
                            <span>这些项目来自同一批已确认剧本，已高亮并排在最前面。</span>
                        </div>
                        <button type="button" onClick={clearBatchFocus}>查看全部项目</button>
                    </section>
                ) : null}

                {!remoteMode && canvasHealth.error ? <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-sm"><span>{canvasHealth.error}</span><Button loading={canvasHealth.loading} onClick={()=>void hydrateLocalCanvasProjectsFromBackend()}>重试加载</Button></div> : null}
                {remoteMode && projectQuery.isError ? (
                    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm">
                        <span>成片项目读取失败，项目画布仍可继续使用。</span>
                        <Button size="small" loading={projectQuery.isFetching} onClick={() => void projectQuery.refetch()}>重试加载项目</Button>
                    </div>
                ) : null}
                {remoteMode && projectQuery.isPending && !focusBatchId ? (
                    <div role="status" className="mb-4 rounded-lg bg-foreground/[.035] px-3 py-2 text-sm text-foreground/55">正在读取成片项目…</div>
                ) : null}
                {remoteMode && libraryQuery.isError ? (
                    <div role="alert">画布列表读取失败<Button onClick={() => void libraryQuery.refetch()}>重试</Button></div>
                ) : !hydrated || (remoteMode && libraryQuery.isPending) ? (
                    <WorkspaceLoadingState label="正在恢复画布" detail="读取本地缓存与账号同步状态" />
                ) : focusBatchId && projectQuery.isPending ? (
                    <WorkspaceLoadingState label="正在整理刚创建的项目" detail="确认同批次项目与制作状态" />
                ) : visibleProjects.length || visibleStudioProjects.length || (!focusBatchId && !keyword && projectFilter === "all") ? (
                    <CollectionGrid className="canvas-collection-grid">
                        {visibleStudioProjects.length ? <div className="project-library-group-heading"><strong>成片项目</strong><span>{visibleStudioProjects.length} 个项目</span></div> : null}
                        {!focusBatchId ? <div className="libtv-create-project-entry">
                            <button type="button" className="libtv-create-project-card" onClick={() => createAndEnter()}>
                                <div className="libtv-create-project-icon"><Plus /></div>
                                <strong>开始创作</strong>
                            </button>
                            <p className="libtv-create-project-subtitle">新建视频项目</p>
                        </div> : null}
                        {libraryFolders.map((folder) => <CanvasLibraryFolderTile key={folder.id} folder={folder} onOpen={() => setFolderFilter(folder.id)} onRename={() => { setFolderName(folder.name); setEditingFolderId(folder.id); setFolderDialogOpen(true); } } onExport={() => void exportFolderProjects(folder)} onDelete={() => setDeletingFolder({ id: folder.id, name: folder.name })} onCoverChange={(dataUrl) => {
                            void persistCanvasFolderCover(folder.id, dataUrl).then(() => {
                                message.success("文件夹封面已更新");
                            }).catch((error) => {
                                message.error(error instanceof Error ? error.message : "封面没有保存成功");
                            });
                        }} />)}
                        {visibleStudioProjects.map((item) => (
                            <StudioProjectCard
                                key={`studio-project-${item.project.id}`}
                                item={item}
                                onOpen={() => navigate(`/projects/${item.project.id}/overview`)}
                                onDelete={() => requestDeleteStudioProject(item)}
                                onDuplicate={() => duplicateStudioProject(item)}
                                onRename={() => {
                                    setRenamingStudioProject(item.project);
                                    setStudioProjectRenameValue(item.project.name);
                                }}
                                onOpenSettings={() => navigate(`/projects/${item.project.id}/settings`)}
                                onArchive={() => void toggleStudioProjectArchive(item)}
                                newBatch={Boolean(focusBatchId && item.project.batchId === focusBatchId)}
                            />
                        ))}
                        {visibleProjects.length ? <div className="project-library-group-heading"><strong>项目画布</strong><span>{visibleProjects.length} 个画布</span></div> : null}
                        {visibleProjects.map((project) => (
                            <CanvasFolderCard
                                key={project.id}
                                project={project}
                                projectName={project.projectId ? projectNames.get(project.projectId) || "未同步项目" : undefined}
                                folders={folders}
                                onMoveToFolder={async (folderId) => {
                                    try {
                                        // Keep the menu action transactional: validate the selected
                                        // folder, update the local store, then verify the in-memory
                                        // relation before reporting success. This prevents a stale
                                        // menu/list state from making a failed move look successful.
                                        if (folderId && !folders.some((folder) => folder.id === folderId)) {
                                            throw new Error("目标文件夹不存在");
                                        }
                                        const projectCanvasIds = canvasIdsForWorkspaceProjects(localProjects, [project.id]);
                                        moveProjectsToFolder(projectCanvasIds, folderId);
                                        await flushCanvasStorePersistence();
                                        const movedProject = useCanvasStore.getState().projects.find((item) => item.id === project.id);
                                        if (!movedProject || (movedProject.folderId || undefined) !== (folderId || undefined)) {
                                            throw new Error("项目移动未完成，请重试");
                                        }
                                        if (!usesBrowserLocalResourceStore()) {
                                            await Promise.all(projectCanvasIds.map((id) => syncLocalCanvasProjectToBackend(id)));
                                        }
                                        message.success(folderId ? "已移动到文件夹" : "已移出文件夹");
                                    } catch (error) {
                                        message.error(error instanceof Error ? error.message : "移动项目失败");
                                    }
                                }}
                                onDuplicate={() => duplicateCanvasProject(project)}
                                onExport={() => exportWorkspaceProject(project)}
                                onDelete={() => {
                                    setDeleteIds([project.id]);
                                }}
                                onClick={() => enterProject(project.id)}
                                onPrefetch={preloadProject}
                            />
                        ))}
                    </CollectionGrid>
                ) : (
                    <WorkspaceState icon="canvas" title={canvasHealth.error ? "项目暂时无法加载" : focusBatchId ? "没有找到刚创建的项目" : keyword || projectFilter !== "all" || folderFilter !== "all" ? "没有匹配的项目" : "让第一个想法落在画布上"} description={canvasHealth.error || (focusBatchId ? "项目可能仍在同步，或这一批项目已被移出当前账号。" : keyword || projectFilter !== "all" || folderFilter !== "all" ? "换一个名称或重置筛选条件。" : "图片、分镜和灵感，都可以在这里自由组织。")} action={canvasHealth.error ? <Button loading={canvasHealth.loading} onClick={()=>void hydrateLocalCanvasProjectsFromBackend()}>重试加载</Button> : focusBatchId ? <Button onClick={clearBatchFocus}>查看全部项目</Button> : !keyword && projectFilter === "all" && folderFilter === "all" ? <Button type="primary" icon={<Plus />} disabled={!hydrated} onClick={() => createAndEnter()}>新建项目</Button> : undefined} />
                )}
                {hydrated && visibleProjects.length && (hasMore || libraryQuery.isFetchNextPageError) ? (
                    <div ref={loadMoreRef} className="library-load-more" aria-live="polite">
                        {libraryQuery.isFetchNextPageError ? <Button onClick={() => void libraryQuery.fetchNextPage()}>加载失败，重试</Button> : hasMore ? "继续下滑加载更多" : `已加载全部 ${filteredProjects.length} 个画布`}
                    </div>
                ) : null}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <Modal
                className="libtv-folder-dialog"
                wrapClassName="libtv-folder-dialog-wrap"
                title="重命名文件夹"
                open={folderDialogOpen}
                okText="保存"
                okButtonProps={{ type: "default" }}
                cancelText="取消"
                onCancel={() => { setFolderDialogOpen(false); setEditingFolderId(null); setFolderName(""); }}
                onOk={saveFolderRename}
            >
                <Input autoFocus value={folderName} placeholder="例如：短片项目" onChange={(event) => setFolderName(event.target.value)} onPressEnter={saveFolderRename} />
            </Modal>
            <Modal
                title="重命名项目"
                open={Boolean(renamingStudioProject)}
                okText="保存"
                cancelText="取消"
                confirmLoading={renameStudioProject.isPending}
                okButtonProps={{ disabled: !studioProjectRenameValue.trim() || renameStudioProject.isPending }}
                onCancel={() => {
                    if (renameStudioProject.isPending) return;
                    setRenamingStudioProject(null);
                    setStudioProjectRenameValue("");
                }}
                onOk={() => {
                    const name = studioProjectRenameValue.trim();
                    if (!renamingStudioProject || !name || renameStudioProject.isPending) return;
                    renameStudioProject.mutate({ projectId: renamingStudioProject.id, name });
                }}
            >
                <Input
                    autoFocus
                    maxLength={80}
                    value={studioProjectRenameValue}
                    placeholder="请输入项目名称"
                    onChange={(event) => setStudioProjectRenameValue(event.target.value)}
                    onPressEnter={() => {
                        const name = studioProjectRenameValue.trim();
                        if (!renamingStudioProject || !name || renameStudioProject.isPending) return;
                        renameStudioProject.mutate({ projectId: renamingStudioProject.id, name });
                    }}
                />
            </Modal>
            <Modal
                title="加入项目"
                open={associationOpen}
                okText="保存关联"
                cancelText="取消"
                okButtonProps={{ disabled: !associationProjectId, loading: projectQuery.isFetching }}
                onCancel={() => setAssociationOpen(false)}
                onOk={() => void associateSelected()}
            >
                <p className="mb-3 text-sm text-foreground/60">选中的画布会保留原有节点和本地媒体，只增加项目关联。</p>
                <Select
                    className="w-full"
                    value={associationProjectId || undefined}
                    placeholder="选择项目"
                    options={(projectQuery.data?.projects || []).map((item) => ({ label: item.project.name, value: item.project.id }))}
                    onChange={setAssociationProjectId}
                />
            </Modal>
            <RecycleBinDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
            {deletingFolder ? <CanvasDeleteConfirmation title={`删除文件夹「${deletingFolder.name}」？`}
                description={`将删除此文件夹及其中 ${localProjects.filter((project) => project.folderId === deletingFolder.id).length} 个画布，画布里的节点和连线也会一起移除。`}
                onCancel={() => setDeletingFolder(null)} onConfirm={async () => {
                    const folderId = deletingFolder.id;
                    const ids = useCanvasStore.getState().projects.filter((project) => project.folderId === folderId).map((project) => project.id);
                    if (ids.length) await deleteLocalCanvasProjects(ids);
                    await deleteCanvasLibraryFolder(folderId);
                    message.success(ids.length ? `已删除文件夹及其中 ${ids.length} 个画布` : "文件夹已删除");
                }} /> : null}
            {deleteDialogOpen ? <Suspense fallback={null}><CanvasDeleteProjectsDialog /></Suspense> : null}
        </WorkspacePage>
    );
}

function StudioProjectCard({ item, onOpen, onDelete, onDuplicate, onRename, onOpenSettings, onArchive, newBatch }: { item: ProjectSummary; onOpen: () => void; onDelete: () => void; onDuplicate: () => void; onRename: () => void; onOpenSettings: () => void; onArchive: () => void; newBatch: boolean }) {
    const stage = projectSummaryStage(item);
    return (
        <LibraryCardShell
            ariaLabel={`打开成片项目 ${item.project.name}`}
            className={`canvas-collection-card${newBatch ? " project-collection-unified-card is-new-batch" : ""}`}
            updatedAt={item.project.updatedAt}
            onOpen={onOpen}
            onPointerEnter={() => preloadWorkspaceRoute(`/projects/${item.project.id}/overview`)}
            cover={
                <div className="canvas-collection-preview-content">
                    <ProjectLibraryCover status={stage.label} tone={stage.tone} statusDetail={stage.detail} />
                </div>
            }
            title={item.project.name}
            actions={
                <div className="canvas-collection-actions" onClick={(event) => event.stopPropagation()}>
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        overlayClassName="project-library-menu"
                        menu={{
                            onClick: ({ domEvent }) => domEvent.stopPropagation(),
                            items: [
                                { key: "open", label: "打开项目", onClick: onOpen },
                                { key: "rename", icon: <Pencil className="size-3.5" />, label: "重命名", onClick: onRename },
                                { key: "duplicate", label: "创建副本", onClick: onDuplicate },
                                { key: "settings", icon: <Settings2 className="size-3.5" />, label: "项目设置", onClick: onOpenSettings },
                                { key: "archive", icon: <Archive className="size-3.5" />, label: item.project.status === "archived" ? "恢复项目" : "归档项目", onClick: onArchive },
                                { type: "divider" },
                                { key: "delete", danger: true, label: "删除项目", onClick: onDelete },
                            ],
                        }}
                    >
                        <button type="button" className="product-icon-button canvas-collection-more" aria-label={`${item.project.name} 项目操作`} title="更多操作" onClick={(event) => event.stopPropagation()}>
                            <MoreHorizontal />
                        </button>
                    </Dropdown>
                </div>
            }
        />
    );
}

function CanvasLibraryFolderTile({ folder, onOpen, onRename, onExport, onDelete, onCoverChange }: { folder: { id: string; name: string; updatedAt: string; coverDataUrl?: string; unsaved?: boolean; saveError?: string }; onOpen: () => void; onRename: () => void; onExport: () => void; onDelete: () => void; onCoverChange: (dataUrl: string) => void }) {
    const { message } = App.useApp();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const chooseCover = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) { message.error("封面请选择图片文件"); return; }
        if (file.size > 12 * 1024 * 1024) { message.error("封面图片不能超过 12MB"); return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== "string") return;
            const image = new Image();
            image.onload = () => {
                const maxSize = 1280;
                const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
                onCoverChange(canvas.toDataURL("image/jpeg", 0.84));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
        event.target.value = "";
    };
    return (
        <LibraryCardShell
            ariaLabel={`打开文件夹 ${folder.name}`}
            className="libtv-folder-card"
            updatedAt={folder.updatedAt}
            onOpen={onOpen}
            title={folder.saveError ? `${folder.name} · 保存失败` : folder.unsaved ? `${folder.name} · 未保存` : folder.name}
            cover={<div className={cn("libtv-folder-cover-art", folder.coverDataUrl && "has-custom-cover")} style={folder.coverDataUrl ? { backgroundImage: `url(${folder.coverDataUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined} />}
            actions={<>
                <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                overlayClassName="project-library-menu folder-library-menu"
                menu={{
                    onClick: ({ domEvent }) => domEvent.stopPropagation(),
                    items: [
                        { key: "open", label: "打开", onClick: onOpen },
                        { key: "rename", label: "重命名", onClick: onRename },
                        { key: "cover", label: "更换封面", onClick: () => coverInputRef.current?.click() },
                        { key: "export", label: "导出文件夹", onClick: onExport },
                        { type: "divider" },
                        { key: "delete", danger: true, label: "删除文件夹", onClick: onDelete },
                    ],
                }}
                >
                    <button type="button" className="product-icon-button libtv-folder-card-more" aria-label={`${folder.name} 文件夹操作`} title="更多操作" onClick={(event) => event.stopPropagation()}><MoreHorizontal /></button>
                </Dropdown>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={chooseCover} />
            </>}
        />
    );
}
