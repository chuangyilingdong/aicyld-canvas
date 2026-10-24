import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewSummary } from "../src/pages/skills/skill-publishing-panel";
import type { SkillReviewSummary } from "../src/services/api/skills";

test("installation review shows both tested scenarios and their actual environment without private examples", () => {
    const review = {
        reviewedAt: "2026-10-21T06:00:00Z", revision: 3, contentHash: "hash",
        trials: ["normal", "missing_input"].map(scenario => ({ scenario, target: "canvas", runtimeVersion: "v2.1.1-aicyld.1", model: "review-model", conclusion: "passed", testedAt: "2026-10-21T05:00:00Z", input: "private-input", output: "private-output" })),
    };
    const html = renderToStaticMarkup(<ReviewSummary summary={review} />);
    for (const text of ["正常使用", "缺少输入", "通过", "画布", "v2.1.1-aicyld.1", "review-model", "审核实测记录"]) expect(html).toContain(text);
    expect(html).not.toContain("private-input");
    expect(html).not.toContain("private-output");
});

test("unfamiliar review conclusions are not presented as passed", () => {
    const review = { reviewedAt: "", revision: 1, contentHash: "", trials: [{ scenario: "future", target: "other", runtimeVersion: "unknown", model: "unknown", conclusion: "pending", testedAt: "" }] } as SkillReviewSummary;
    const html = renderToStaticMarkup(<ReviewSummary summary={review} />);
    expect(html).toContain("未通过");
    expect(html).toContain("future");
    expect(html).toContain("时间未记录");
});
