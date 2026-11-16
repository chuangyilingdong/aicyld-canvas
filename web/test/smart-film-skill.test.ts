import { describe, expect, it } from "bun:test";

import { smartFilmScriptPrompt } from "@/lib/canvas/smart-film-scripts";
import type { SmartFilmSkillSnapshot } from "@/services/api/smart-film-batches";
import type { Skill, SkillPackageFile, SkillPackageFileContent } from "@/services/api/skills";
import { createSmartFilmSkillSnapshotWithDependencies, smartFilmSkillMetadata, smartFilmSkillStagePrompt } from "@/services/smart-film-skill";

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

    it("keeps image and video prompts within the model limits while preserving the platform task", () => {
        const longSnapshot = {
            ...snapshot,
            stages: { image: "图片规则".repeat(10_000), video: "视频规则".repeat(10_000) },
        } satisfies SmartFilmSkillSnapshot;
        const imageTask = `图片任务-${"画面细节".repeat(800)}`;
        const videoTask = `视频任务-${"动作细节".repeat(800)}`;
        const imagePrompt = smartFilmSkillStagePrompt(longSnapshot, "image", imageTask);
        const videoPrompt = smartFilmSkillStagePrompt(longSnapshot, "video", videoTask);
        expect(imagePrompt.length).toBeLessThanOrEqual(5_000);
        expect(videoPrompt.length).toBeLessThanOrEqual(4_000);
        expect(imagePrompt).toContain("图片任务-");
        expect(videoPrompt).toContain("视频任务-");
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

    it("uses an explicit stage route manifest when the skill provides one", async () => {
        const routes = {
            stages: {
                script: ["references/script.md"],
                assets: ["references/assets.md"],
                storyboard: ["references/storyboard.md"],
                image: ["references/image.md"],
                video: ["references/video.md"],
            },
        };
        const files = [
            { path: "SKILL.md" },
            { path: "aicyld-stages.json" },
            { path: "references/script.md" },
            { path: "references/assets.md" },
            { path: "references/storyboard.md" },
            { path: "references/image.md" },
            { path: "references/video.md" },
        ];
        const contents = new Map<string, string>([
            ["SKILL.md", "# 导演技能"],
            ["aicyld-stages.json", JSON.stringify(routes)],
            ["references/script.md", "剧本规则"],
            ["references/assets.md", "资产规则"],
            ["references/storyboard.md", "分镜规则"],
            ["references/image.md", "图片规则"],
            ["references/video.md", "视频规则"],
        ]);
        const snapshot = await createSmartFilmSkillSnapshotWithDependencies(skill(), {
            listFiles: async () => ({ files: files.map((file) => ({ path: file.path, kind: "markdown", mimeType: "text/markdown", size: 1, sha256: file.path })) as SkillPackageFile[] }),
            getFile: async (_id, path) => ({ file: { file: { path, kind: "markdown", mimeType: "text/markdown", size: 1, sha256: path }, content: path === "aicyld-stages.json" ? JSON.stringify(routes) : contents.get(path) || "", binary: false } as SkillPackageFileContent }),
        });
        expect(snapshot.routingMode).toBe("manifest");
        expect(snapshot.stageFiles?.script).toEqual(["SKILL.md", "references/script.md"]);
        expect(snapshot.stages?.video).toContain("视频规则");
    });
});

function skill(): Skill {
    return {
        skillId: "skill-one", skillName: "短剧导演", description: "导演工作流", versionId: "version-one", version: "1", contentHash: "hash-one",
        fileCount: 7, totalBytes: 100, sourceType: "zip", sourceUrl: "", sourceRef: "", sourceSubdir: "", sourceCommit: "", syncStatus: "synced", autoUpdate: false,
        status: 1, markdownUrl: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: 0, tag: "drama", sortWeight: 0,
        isPrivate: true, likeCount: 0, isLike: false, ownerUid: "user", effectiveUser: { name: "用户", avatarUrl: "", uid: "user" }, originalSkillId: null,
        showcaseMedia: [], addedCount: 1, isTest: false, extraInfo: "", isAdded: true, isOwner: true,
    };
}
