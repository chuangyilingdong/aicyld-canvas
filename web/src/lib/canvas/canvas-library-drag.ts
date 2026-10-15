export const CANVAS_LIBRARY_DRAG_TYPE = "application/x-libtv-canvas-project";

type DragLike = { dataTransfer: DataTransfer };

/** 从画布卡片开始拖拽：带上画布 id，供文件夹卡片作为落点读取。 */
export function beginCanvasLibraryDrag(event: DragLike, projectId: string) {
    event.dataTransfer.setData(CANVAS_LIBRARY_DRAG_TYPE, projectId);
    // 兼容兜底：部分浏览器/场景只认 text/plain。
    event.dataTransfer.setData("text/plain", projectId);
    event.dataTransfer.effectAllowed = "move";
}

/** 判断这次拖拽是不是「画布卡片」发起的（拖文件、拖文本都不算，避免误移）。 */
export function isCanvasLibraryDrag(event: DragLike) {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, CANVAS_LIBRARY_DRAG_TYPE) >= 0;
}

/** 读出被拖拽的画布 id；不是画布卡片拖拽时返回空串。 */
export function readCanvasLibraryDrag(event: DragLike) {
    if (!isCanvasLibraryDrag(event)) return "";
    return String(event.dataTransfer.getData(CANVAS_LIBRARY_DRAG_TYPE) || "").trim();
}