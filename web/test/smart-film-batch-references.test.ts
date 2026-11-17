import { describe, expect, test } from "bun:test";

import { referenceDefaultName } from "@/lib/canvas/smart-film-reference-defaults";

describe("smart film batch reference names", () => {
    test("keeps a semantic product name for every product view", () => {
        expect(referenceDefaultName("机甲狂鲨", "product", 0)).toBe("机甲狂鲨");
        expect(referenceDefaultName("机甲狂鲨", "product", 1)).toBe("机甲狂鲨");
    });

    test("replaces generic upload names with a role label that can be edited", () => {
        expect(referenceDefaultName("03", "product", 0)).toBe("产品");
        expect(referenceDefaultName("生成图片", "product", 1)).toBe("产品");
    });
});
