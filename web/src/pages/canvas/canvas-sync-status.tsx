import { App, Button, Dropdown, Popover } from "antd";
import { CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { readAllCanvasSyncDrafts, readCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { getActiveUserScope } from "@/lib/user-scope";
import { acceptExternalCanvasRevision, hasUnconfirmedCanvasEdits, pendingExternalCanvasRevision, syncLocalCanvasProjectToBackend } from "@/services/local-workspace-repository";
import { canvasExternalRevisionVersion, subscribeCanvasExternalRevision, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { canvasSyncProgressKey, useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { workspaceCapabilities } from "@/services/workspace-mode";

export function CanvasSyncStatus({ projectId, onOpenVersions }: { projectId: string; onLoadLatest?: () => Promise<void>; onOpenVersions?: () => void }) {
    const { message } = App.useApp();
    const progress = useSyncProgressStore((state) => state.syncingProjects[canvasSyncProgressKey(projectId)]);
    const localOnly = workspaceCapabilities().local;
    const [busy, setBusy] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    // 外部改动被本地编辑挡住时必须在顶栏一直看得见：它以前藏在侧边面板里，
    // 面板关着的时候用户根本不知道画布已经在别处变了。
    const externalRevision = useSyncExternalStore(subscribeCanvasExternalRevision, canvasExternalRevisionVersion);
    const externalConflict = pendingExternalCanvasRevision(projectId);
    const [adopting, setAdopting] = useState(false);
    const phase = progress?.phase;
    const conflict = phase === "conflict";
    // 注意：phase 在「还没发生过保存动作」时就是 undefined，那不是失败。
    // 之前把 !phase 也算进 failed，导致新画布一打开就显示「保存失败」，而且怎么点重试都不变。
    const failed = phase === "error" || conflict;
    const saving = phase === "pending" || phase === "saving" || phase === "uploading";
    const unconfirmed = !localOnly && hasUnconfirmedCanvasEdits(projectId);
    // 这是托管网站：文档只有一份（服务端），不存在「本地 vs 云端」两套。这里只表达
    // 「保存中 / 已保存 / 没保存上（可重试）」，不再引入云端/冲突这些桌面端概念。
    const label = localOnly ? "已保存在本机" : saving ? "正在保存" : failed ? "保存失败" : unconfirmed ? "未保存" : "已保存";
    const run = async (operation: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await operation();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败，请重试");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {externalConflict ? (
                <Button
                    size="small"
                    type="text"
                    data-canvas-external-revision={externalRevision}
                    className="canvas-sync-external-notice"
                    loading={adopting}
                    aria-label="画布已在别处更新，使用最新版本"
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={() => {
                        setAdopting(true);
                        void acceptExternalCanvasRevision(projectId)
                            .catch(() => message.error("加载最新版本失败，请重试"))
                            .finally(() => setAdopting(false));
                    }}
                >
                    <span className="canvas-sync-status-label text-xs">画布已在别处更新 · 使用最新版本</span>
                </Button>
            ) : null}
            <Popover
                trigger="click"
                placement="bottom"
                open={statusOpen}
                onOpenChange={setStatusOpen}
                content={
                    <div className="max-w-80 space-y-3" data-canvas-no-zoom>
                        <p role="status" className="text-sm">
                            {localOnly
                                ? "画布已保存在本机。"
                                : saving
                                  ? progress?.message || "正在保存…"
                                  : failed
                                    ? `没能保存${progress?.message ? `：${progress.message}` : ""}。点「重新保存」重试。`
                                    : unconfirmed
                                      ? "有改动还没保存，点「重新保存」即可。"
                                      : "改动已保存。"}
                        </p>
                        {!localOnly && conflict ? <p className="text-xs text-muted-foreground">自动保存暂停过，点「重新保存」重试；想保留当前内容可先「下载画布素材」。</p> : null}
                        <div className="flex flex-wrap gap-2">
                            {!localOnly ? (
                                <Button
                                    size="small"
                                    type="primary"
                                    loading={busy}
                                    onClick={() =>
                                        void run(async () => {
                                            await syncLocalCanvasProjectToBackend(projectId);
                                            message.success("已保存");
                                        })
                                    }
                                >
                                    重新保存
                                </Button>
                            ) : null}
                            <Button
                                size="small"
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        const project = useCanvasStore.getState().openProject(projectId);
                                        if (project) {
                                            const result = await exportCanvasProjects([project], `${project.title}-本地草稿`);
                                            if (result === "cancelled") return;
                                        }
                                    })
                                }
                            >
                                下载画布素材
                            </Button>
                            {onOpenVersions ? (
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setStatusOpen(false);
                                        onOpenVersions();
                                    }}
                                >
                                    版本记录{progress?.draftCount ? ` · ${progress.draftCount} 份草稿` : ""}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                }
            >
                <Button
                    type="text"
                    size="small"
                    danger={!localOnly && failed}
                    aria-label={`画布保存状态：${label}`}
                    icon={saving ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : failed ? <RefreshCw className="size-3.5" /> : <CheckCircle2 className="size-3.5 text-emerald-500" />}
                >
                    <span className="canvas-sync-status-label text-xs">{label}</span>
                </Button>
            </Popover>
        </>
    );
}

export function CanvasSyncDraftMenu({ projectId }: { projectId?: string }) {
    const { message } = App.useApp();
    const [drafts, setDrafts] = useState<CanvasSyncDraft[]>([]);
    const [draftScope, setDraftScope] = useState("");
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    return (
        <Dropdown
            trigger={["click"]}
            onOpenChange={(open) => {
                if (!open) return;
                const scope = getActiveUserScope();
                setDraftScope(scope);
                setDrafts([]);
                setLoading(true);
                void (projectId ? readCanvasSyncDrafts(projectId, scope) : readAllCanvasSyncDrafts(scope))
                    .then((items) => {
                        if (getActiveUserScope() === scope) setDrafts(items.reverse());
                    })
                    .catch(() => message.error("读取本地草稿失败"))
                    .finally(() => setLoading(false));
            }}
            menu={{
                items: drafts.length
                    ? drafts.map((draft) => ({
                          key: draft.id,
                          label: `${draft.project.title} · ${new Date(draft.savedAt).toLocaleString()}`,
                          onClick: () => {
                              if (getActiveUserScope() !== draftScope) {
                                  setDrafts([]);
                                  message.error("账号已切换，请重新打开本地草稿");
                                  return;
                              }
                              setExporting(true);
                              void exportCanvasProjects([draft.project], `${draft.project.title}-本地草稿`, { includeLocalDrawings: false })
                                  .then((result) => {
                                      if (result === "saved") message.success("草稿已下载，可从画布列表导入为新画布");
                                  })
                                  .catch(() => message.error("草稿下载失败，请重试"))
                                  .finally(() => setExporting(false));
                          },
                      }))
                    : [{ key: "empty", label: loading ? "正在读取草稿…" : "暂无本地草稿", disabled: true }],
            }}
        >
            <Button size={projectId ? "small" : "middle"} loading={exporting}>
                本地草稿
            </Button>
        </Dropdown>
    );
}
