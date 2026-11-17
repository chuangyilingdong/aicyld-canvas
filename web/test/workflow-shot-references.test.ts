import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import type { ProjectAsset, ProjectAssetCandidate, ProjectDetail } from "@/services/api/projects";
import { buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, missingPrimaryProductReferences, resolveShotAssetMentionPrompt, smartFilmPrimaryProductName, stripUnboundShotAssetMentions, withPrimaryProductReferences } from "@/pages/projects/detail/workflow-shot-references";

describe("workflow shot asset references", () => {
    test("builds ordered image references for bound media and characters", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(context.mentionReferences.map((reference) => reference.label)).toEqual(["雨夜街道", "林默"]);
        expect(context.referenceImages.map((image) => image.id)).toEqual(["asset-scene", "asset-character"]);
        expect(context.referenceImages[1]?.storageKey).toBe("resource:character-cover");
    });

    test("resolves asset tokens to the submitted reference image order", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const [scene, character] = context.mentionReferences;
        const prompt = `让 ${canvasResourceMentionToken(character)} 从 ${canvasResourceMentionToken(scene)} 走近镜头`;

        expect(resolveShotAssetMentionPrompt(prompt, context)).toContain("让 图片2 从 图片1 走近镜头");
    });

    test("binds explicit character and scene names to their own shot images", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        const prompt = resolveShotAssetMentionPrompt("林默保持静止站立姿态，背景是雨夜街道", context);

        expect(prompt).toContain("林默 图片2保持静止站立姿态");
        expect(prompt).toContain("雨夜街道 图片1");
    });

    test("uses the whole-film reference indexes instead of per-shot indexes", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        const prompt = resolveShotAssetMentionPrompt("林默走在雨夜街道", context, {
            imageIndexByAssetId: new Map([["asset-scene", 7], ["asset-character", 9]]),
        });

        expect(prompt).toContain("林默 图片9走在雨夜街道 图片7");
        expect(prompt).toContain("雨夜街道：场景参考：图片7");
    });

    test("removes stale mentions before single-shot generation while preserving bound references", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const [scene, character] = context.mentionReferences;
        const prompt = `让 ${canvasResourceMentionToken(character)} 从 ${canvasResourceMentionToken(scene)} 走近，旁边保留 @[asset:missing]`;

        const stripped = stripUnboundShotAssetMentions(prompt, context);

        expect(stripped).toContain(canvasResourceMentionToken(character));
        expect(stripped).toContain(canvasResourceMentionToken(scene));
        expect(stripped).not.toContain("@[asset:missing]");
        expect(stripped).not.toMatch(/\s{2,}/);
    });
    test("rejects stale mentions after an asset is unbound", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(() => resolveShotAssetMentionPrompt("跟随 @[asset:missing]", context)).toThrow("未绑定到当前镜头");
    });

    test("rejects text-only asset mentions before image generation", () => {
        const value = detail();
        value.assets.push({
            id: "asset-prop-text",
            title: "旧怀表",
            mediaType: "text",
            category: "prop",
            status: "confirmed",
            primaryVersionId: "version-prop-text",
            versionCount: 1,
            usages: [],
            position: 3,
            updatedAt: "2026-08-29T00:00:04Z",
        } satisfies ProjectAsset);
        value.shotReferences = [
            ...(value.shotReferences || []),
            { id: "reference-prop-text", shotId: "shot-1", assetVersionId: "version-prop-text", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:04Z" },
        ];

        const context = buildShotAssetReferenceContext(value, "shot-1");
        expect(context.mentionReferences.map((reference) => reference.assetId)).not.toContain("asset-prop-text");
        expect(() => resolveShotAssetMentionPrompt("特写 @[asset:asset-prop-text]", context)).toThrow("未绑定到当前镜头");
    });

    test("adds bound assets as editable mention tokens without duplicating existing mentions", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("让 @[asset:asset-character] 走近镜头", context.mentionReferences);

        expect(prompt).toContain("@[asset:asset-character]");
        expect(prompt.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
        expect(prompt).toContain("【资产引用】\n- 雨夜街道：@[asset:asset-scene]");
    });

    test("keeps normalized editable prompts idempotent", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const once = ensureShotAssetMentionPrompt("林默保持静止站立姿态", context.mentionReferences);
        const twice = ensureShotAssetMentionPrompt(once, context.mentionReferences);

        expect(twice).toBe(once);
        expect(twice.match(/【资产引用】/g)).toHaveLength(1);
        expect(twice.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
        expect(twice.match(/@\[asset:asset-scene\]/g)).toHaveLength(1);
    });

    test("groups same-name character views into one multi-view reference", () => {
        const value = detail();
        value.assets.push({
            id: "asset-character-side",
            title: "林默",
            mediaType: "entity",
            category: "character",
            status: "confirmed",
            primaryVersionId: "version-character-side",
            versionCount: 1,
            usages: [],
            position: 3,
            updatedAt: "2026-08-29T00:00:05Z",
            character: {
                versionId: "version-character-side",
                version: 1,
                definition: {},
                representations: [{ id: "representation-side", resourceId: "character-side", mediaType: "image", role: "primary" }],
                visualStatus: "ready",
                voiceStatus: "missing",
            },
        } satisfies ProjectAsset);
        value.shotReferences = [
            ...(value.shotReferences || []),
            { id: "reference-character-side", shotId: "shot-1", assetVersionId: "version-character-side", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:05Z" },
        ];
        const context = buildShotAssetReferenceContext(value, "shot-1");
        const prompt = resolveShotAssetMentionPrompt("林默保持静止站立姿态", context);
        expect(prompt).toContain("林默：人物参考：图片2、3（同一角色多视图参考）");
        expect(prompt).not.toContain("@[asset:asset-character]");
        expect(prompt.match(/【资产参考】/g)).toHaveLength(1);
    });

    test("replaces previously managed reference blocks instead of stacking them", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const first = resolveShotAssetMentionPrompt("林默走在雨夜街道", context);
        const second = resolveShotAssetMentionPrompt(first, context);

        expect(second).toBe(first);
        expect(second.match(/【资产参考】/g)).toHaveLength(1);
        expect(second.match(/林默：人物参考/g)).toHaveLength(1);
        expect(second.match(/雨夜街道：场景参考/g)).toHaveLength(1);
    });

    test("adds strict identity and product locks after resolving references", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = resolveShotAssetMentionPrompt("林默站在雨夜街道", context);

        expect(prompt).toContain("【参考图一致性】");
        expect(prompt).toContain("禁止互换人物身份或产品");
        expect(prompt).toContain("沿用参考图本身的视觉风格");
    });

    test("blocks the primary product from being generated without a product reference", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const candidate = {
            id: "candidate-product",
            projectId: "project-1",
            name: "机甲狂鲨",
            category: "prop",
            status: "pending_confirmation",
        } as ProjectAssetCandidate;

        expect(missingPrimaryProductReferences("画面出现机甲狂鲨", "机甲狂鲨海底急救赛", context.mentionReferences, [candidate])).toEqual(["机甲狂鲨"]);
        expect(missingPrimaryProductReferences("画面出现机甲狂鲨", "机甲狂鲨海底急救赛", [{ category: "prop" }], [candidate])).toEqual([]);
    });

    test("automatically adds mapped input product images and uses the semantic alias", () => {
        const value = detail();
        value.assets.push({
            id: "asset-product",
            title: "03",
            mediaType: "image",
            category: "prop",
            status: "confirmed",
            primaryVersionId: "version-product",
            versionCount: 1,
            usages: [],
            position: 4,
            storageKey: "resource:product-image",
            updatedAt: "2026-08-29T00:00:06Z",
        } satisfies ProjectAsset);
        const candidate = {
            id: "candidate-product",
            projectId: "project-1",
            name: "机甲狂鲨",
            category: "prop",
            status: "pending_confirmation",
        } as ProjectAssetCandidate;
        const productName = smartFilmPrimaryProductName({ "asset-product": "product" }, {}, [candidate], "机甲狂鲨海底急救赛");
        const context = withPrimaryProductReferences(
            buildShotAssetReferenceContext(value, "shot-1"),
            value,
            { "asset-product": "product" },
            productName,
            "机甲狂鲨从海沟冲出",
        );

        expect(productName).toBe("机甲狂鲨");
        expect(context.mentionReferences.find((reference) => reference.assetId === "asset-product")?.title).toBe("机甲狂鲨");
        expect(context.referenceImages.map((image) => image.id)).toContain("asset-product");
        expect(missingPrimaryProductReferences("机甲狂鲨从海沟冲出", "机甲狂鲨海底急救赛", context.mentionReferences, [candidate])).toEqual([]);
    });
});

function detail(): ProjectDetail {
    const scene = {
        id: "asset-scene",
        title: "雨夜街道",
        mediaType: "image",
        category: "environment",
        status: "confirmed",
        primaryVersionId: "version-scene",
        versionCount: 1,
        usages: [],
        position: 0,
        storageKey: "resource:scene-image",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    const character = {
        id: "asset-character",
        title: "林默",
        mediaType: "entity",
        category: "character",
        status: "confirmed",
        primaryVersionId: "version-character",
        versionCount: 1,
        usages: [],
        position: 1,
        updatedAt: "2026-08-29T00:00:00Z",
        character: {
            versionId: "version-character",
            version: 1,
            definition: {},
            representations: [{ id: "representation-1", resourceId: "character-cover", mediaType: "image", role: "primary" }],
            visualStatus: "ready",
            voiceStatus: "missing",
        },
    } satisfies ProjectAsset;
    const audio = {
        id: "asset-audio",
        title: "雨声",
        mediaType: "audio",
        category: "other",
        status: "confirmed",
        primaryVersionId: "version-audio",
        versionCount: 1,
        usages: [],
        position: 2,
        storageKey: "resource:rain-audio",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    return {
        assets: [scene, character, audio],
        shotReferences: [
            { id: "reference-scene", shotId: "shot-1", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:00Z" },
            { id: "reference-character", shotId: "shot-1", assetVersionId: "version-character", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:01Z" },
            { id: "reference-audio", shotId: "shot-1", assetVersionId: "version-audio", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:02Z" },
            { id: "reference-other-shot", shotId: "shot-2", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:03Z" },
        ],
    } as ProjectDetail;
}
