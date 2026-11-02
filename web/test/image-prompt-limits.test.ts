import { describe, expect, test } from "bun:test";

import { imagePromptLengthError } from "../src/lib/canvas/image-prompt-limits";

describe("image prompt limits", () => {
    test("ZhenZhen image models require 5 to 5000 characters", () => {
        expect(imagePromptLengthError("您好", "zhenzhen-image-g-v2.5-lowprice")).toBe("当前图片模型的提示词至少需要 5 个字符");
        expect(imagePromptLengthError("您好请生成", "zhenzhen-image-g-v2.5-lowprice")).toBeNull();
        expect(imagePromptLengthError("测".repeat(5001), "zhenzhen-image-g-v2.5-lowprice")).toBe("当前图片模型的提示词最多支持 5000 个字符");
    });

    test("other image models are not constrained by the ZhenZhen rule", () => {
        expect(imagePromptLengthError("您好", "gpt-image-2")).toBeNull();
    });
});
