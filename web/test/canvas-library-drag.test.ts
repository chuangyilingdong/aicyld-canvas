import { describe, expect, test } from "bun:test";

import { CANVAS_LIBRARY_DRAG_TYPE, beginCanvasLibraryDrag, isCanvasLibraryDrag, readCanvasLibraryDrag } from "@/lib/canvas/canvas-library-drag";

function fakeTransfer(types: string[] = [], data: Record<string, string> = {}) {
    const store = new Map(Object.entries(data));
    const list = [...types];
    return {
        get types() { return list; },
        effectAllowed: "",
        dropEffect: "",
        setData(type: string, value: string) {
            store.set(type, value);
            if (!list.includes(type)) list.push(type);
        },
        getData(type: string) {
            return store.get(type) ?? "";
        },
    } as unknown as DataTransfer;
}

describe("画布卡片拖拽载荷", () => {
    test("带上传画布 id，并声明为 move", () => {
        const transfer = fakeTransfer();
        beginCanvasLibraryDrag({ dataTransfer: transfer }, "canvas-1");
        expect(transfer.getData(CANVAS_LIBRARY_DRAG_TYPE)).toBe("canvas-1");
        expect(transfer.getData("text/plain")).toBe("canvas-1");
        expect(transfer.effectAllowed).toBe("move");
        expect(isCanvasLibraryDrag({ dataTransfer: transfer })).toBe(true);
    });

    test("拖文件/拖文本不会被当成画布卡片（避免误移）", () => {
        const files = fakeTransfer(["Files"]);
        expect(isCanvasLibraryDrag({ dataTransfer: files })).toBe(false);
        expect(readCanvasLibraryDrag({ dataTransfer: files })).toBe("");

        const text = fakeTransfer(["text/plain"], { "text/plain": "随便一段文字" });
        expect(isCanvasLibraryDrag({ dataTransfer: text })).toBe(false);
        expect(readCanvasLibraryDrag({ dataTransfer: text })).toBe("");
    });

    test("落点能读回画布 id", () => {
        const transfer = fakeTransfer();
        beginCanvasLibraryDrag({ dataTransfer: transfer }, "  canvas-2  ");
        expect(readCanvasLibraryDrag({ dataTransfer: transfer })).toBe("canvas-2");
    });
});