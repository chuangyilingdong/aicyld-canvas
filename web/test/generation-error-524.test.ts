import { describe, expect, test } from "bun:test";

import { explainGenerationError } from "../src/lib/generation-error";

describe("HTTP 524 failure contract", () => {
    test("keeps upstream timeout uncertain and blocks replay until checked", () => {
        const explanation = explainGenerationError({
            status: 524,
            message: "524 A Timeout Occurred",
            response: { data: "<html>524</html>" },
        });

        expect(explanation.category).toBe("timeout");
        expect(explanation.httpStatus).toBe(524);
        expect(explanation.uncertain).toBe(true);
        expect(explanation.retryable).toBe(false);
        expect(explanation.blockAutomaticRetry).toBe(true);
        expect(explanation.blockManualRetry).toBe(true);
        expect(explanation.reason).toContain("HTTP 524");
        expect(explanation.action).toContain("不要立即重新提交");
    });
});
