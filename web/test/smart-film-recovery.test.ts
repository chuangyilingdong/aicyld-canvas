import { describe, expect, test } from "bun:test";

import { smartFilmRecoveryMessage, smartFilmRecoveryStage } from "../src/pages/smart-film/smart-film-recovery";

describe("smart film recovery actions", () => {
    test("only exposes stage recovery for asset and storyboard failures", () => {
        expect(smartFilmRecoveryStage("assets")).toBe("assets");
        expect(smartFilmRecoveryStage("storyboard")).toBe("storyboard");
        expect(smartFilmRecoveryStage("project")).toBeNull();
        expect(smartFilmRecoveryStage(undefined)).toBeNull();
    });

    test("distinguishes reused results from forced regeneration", () => {
        expect(smartFilmRecoveryMessage("retry", true)).toContain("未重复提交或扣费");
        expect(smartFilmRecoveryMessage("retry", false)).toContain("已提交新的失败阶段任务");
        expect(smartFilmRecoveryMessage("regenerate", false)).toContain("重新调用模型");
    });
});
