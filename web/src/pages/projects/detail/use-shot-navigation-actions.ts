import { App } from "antd";

import type { ProjectShot } from "@/services/api/projects";

export function useShotNavigationActions({
    shots,
    selectedShot,
    editorDirty,
    watchedTitle,
    onSelectShot,
    onAddShot,
    onDeleteShot,
}: {
    shots: ProjectShot[];
    selectedShot?: ProjectShot;
    editorDirty: boolean;
    watchedTitle?: string;
    onSelectShot: (shotId: string) => void;
    onAddShot: () => void;
    onDeleteShot: (shotId: string, nextShotId: string) => Promise<unknown>;
}) {
    const { modal } = App.useApp();
    const shotIndex = selectedShot ? shots.findIndex((shot) => shot.id === selectedShot.id) : -1;
    const requestShotSelection = (nextShotId: string) => {
        if (!selectedShot) return;
        if (nextShotId === selectedShot.id) return;
        if (!editorDirty) {
            onSelectShot(nextShotId);
            return;
        }
        modal.confirm({
            title: "当前镜头有未保存修改",
            content: "切换镜头会放弃这些修改。",
            okText: "放弃修改并切换",
            cancelText: "继续编辑",
            onOk: () => onSelectShot(nextShotId),
        });
    };
    const requestAddShot = () => {
        if (!editorDirty) {
            onAddShot();
            return;
        }
        modal.confirm({
            title: "当前镜头有未保存修改",
            content: "新增镜头会离开当前编辑内容。",
            okText: "放弃修改并新增",
            cancelText: "继续编辑",
            onOk: onAddShot,
        });
    };
    const requestDeleteShot = () => {
        if (!selectedShot) return;
        const nextShot = shots[shotIndex + 1] || shots[shotIndex - 1];
        return modal.confirm({
            title: `删除镜头“${watchedTitle || selectedShot.title || "未命名镜头"}”？`,
            content: editorDirty
                ? "该镜头的未保存修改、脚本版本、资产引用和生成产物都会被删除，且无法恢复。"
                : "该镜头的脚本版本、资产引用和生成产物都会被删除，且无法恢复。",
            okText: "删除镜头",
            okButtonProps: { danger: true },
            cancelText: "取消",
            centered: true,
            onOk: () => onDeleteShot(selectedShot.id, nextShot?.id || ""),
        });
    };
    const selectRelativeShot = (offset: number) => {
        const next = shots[shotIndex + offset];
        if (next) requestShotSelection(next.id);
    };
    return { requestAddShot, requestDeleteShot, requestShotSelection, selectRelativeShot };
}
