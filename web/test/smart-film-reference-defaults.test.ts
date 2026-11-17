import { describe, expect, test } from "bun:test";

import { characterReferenceDisplayName, needsPlatformDefaultSkillConfirmation } from "../src/lib/canvas/smart-film-reference-defaults";

describe("smart-film reference defaults", () => {
    test("uses a meaningful asset title as the character name", () => {
        expect(characterReferenceDisplayName("小满", 0)).toBe("小满");
    });

    test("replaces generic generated titles with stable ordinal names", () => {
        expect(characterReferenceDisplayName("生成图片", 0)).toBe("角色 1");
        expect(characterReferenceDisplayName("未命名图片", 1)).toBe("角色 2");
    });

    test("asks before a batch silently falls back to platform skill rules", () => {
        expect(needsPlatformDefaultSkillConfirmation(1, "")).toBe(true);
        expect(needsPlatformDefaultSkillConfirmation(1, "skill-1")).toBe(false);
        expect(needsPlatformDefaultSkillConfirmation(0, "")).toBe(false);
    });
});
