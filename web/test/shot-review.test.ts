import { describe, expect, test } from "bun:test";

import { appendShotReworkInstruction } from "../src/pages/projects/detail/shot-review";

describe("shot review rework instruction", () => {
    test("appends a review instruction without stacking previous instructions", () => {
        const first = appendShotReworkInstruction("保持服装一致", "手部位置不对");
        const second = appendShotReworkInstruction(first, "产品 logo 朝向反了");
        expect(second).toContain("保持服装一致");
        expect(second).toContain("产品 logo 朝向反了");
        expect(second).not.toContain("手部位置不对");
        expect(second.match(/【审核返工意见】/g)).toHaveLength(1);
    });

    test("handles missing notes and empty instructions", () => {
        expect(appendShotReworkInstruction(undefined, "人物表情自然")).toBe("【审核返工意见】\n人物表情自然");
        expect(appendShotReworkInstruction("原备注", "  ")).toBe("原备注");
    });
});
