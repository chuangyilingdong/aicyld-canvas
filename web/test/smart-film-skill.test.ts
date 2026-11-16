import { describe, expect, it } from "bun:test";

import { smartFilmScriptPrompt } from "@/lib/canvas/smart-film-scripts";
import type { SmartFilmSkillSnapshot } from "@/services/api/smart-film-batches";
import { smartFilmSkillMetadata, smartFilmSkillStagePrompt } from "@/services/smart-film-skill";

const snapshot: SmartFilmSkillSnapshot = {
    skillId: "skill-one",
    versionId: "version-one",
    contentHash: "hash-one",
    name: "短剧导演",
    version: "1",
    stages: { script: "唯一技能包：剧本规范" },
};

describe("smart film single skill context", () => {
    it("wraps exactly one skill context with the platform task", () => {
        const prompt = smartFilmSkillStagePrompt(snapshot, "script", "平台剧本任务");
        expect(prompt).toContain("唯一技能包：剧本规范");
        expect(prompt).toContain("【平台阶段任务】\n平台剧本任务");
        expect(prompt.match(/唯一技能包/g)?.length).toBe(1);
    });

    it("emits a single pinned skill identity", () => {
        expect(smartFilmSkillMetadata(snapshot)).toEqual({
            skillId: "skill-one",
            skillVersionId: "version-one",
            skillContentHash: "hash-one",
        });
    });

    it("requires scripts to preserve supplied character names", () => {
        const prompt = smartFilmScriptPrompt({
            idea: "林默和母亲在雨夜相遇",
            references: [{ title: "林默", role: "character" }, { title: "母亲", role: "character" }],
            count: 1,
        });
        expect(prompt).toContain("人物参考：林默、母亲");
        expect(prompt).toContain("剧本必须原样使用该名称");
    });
});
