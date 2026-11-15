import { describe, expect, test } from "bun:test";

import { activeShotAssetRoles, isProjectAssetVisualReference, linkedShotAssetReferences, parseShotAssetRoles, shotAssetRoleLabel } from "../src/pages/projects/detail/shot-asset-roles";
import { revisionInput, shotEditorValues } from "../src/pages/projects/detail/workflow-production-helpers";
import type { ProjectAsset, ProjectDetail, ProjectShot, ShotAssetReference } from "../src/services/api/projects";

describe("shot asset roles", () => {
    test("parses valid role metadata and ignores malformed entries", () => {
        expect(parseShotAssetRoles(JSON.stringify([
            { assetId: "product-1", versionId: "v1", title: "咖啡机", role: "product" },
            { assetId: "", role: "product" },
            { assetId: "scene-1" },
        ]))).toEqual([{ assetId: "product-1", versionId: "v1", title: "咖啡机", role: "product" }]);
        expect(parseShotAssetRoles("not-json")).toEqual([]);
    });

    test("labels explicit product, character, scene and prop roles", () => {
        expect(shotAssetRoleLabel("product", "prop")).toBe("产品");
        expect(shotAssetRoleLabel("character", "character")).toBe("人物");
        expect(shotAssetRoleLabel("environment", "environment")).toBe("场景");
        expect(shotAssetRoleLabel("prop", "prop")).toBe("道具");
        expect(shotAssetRoleLabel(undefined, "environment")).toBe("场景");
    });

    test("shows only linked reference assets and supports multiple products", () => {
        const references = [
            { id: "a", role: "reference", status: "linked" },
            { id: "b", role: "reference", status: "linked" },
            { id: "c", role: "output", status: "linked" },
            { id: "d", role: "reference", status: "deleted" },
        ] as ShotAssetReference[];
        expect(linkedShotAssetReferences(references).map((reference) => reference.id)).toEqual(["a", "b"]);
    });

    test("distinguishes visual reference assets from text-only settings", () => {
        expect(isProjectAssetVisualReference({ id: "image", title: "产品图", mediaType: "image", storageKey: "resource:image-1" } as ProjectAsset)).toBe(true);
        expect(isProjectAssetVisualReference({ id: "text", title: "场景设定", mediaType: "text" } as ProjectAsset)).toBe(false);
        expect(isProjectAssetVisualReference({ id: "broken-image", title: "缺图", mediaType: "image" } as ProjectAsset)).toBe(false);
        expect(isProjectAssetVisualReference({
            id: "character",
            title: "角色",
            mediaType: "entity",
            character: {
                versionId: "v1",
                version: 1,
                definition: {},
                representations: [{ id: "rep", resourceId: "resource-character", mediaType: "image/png", role: "primary" }],
                visualStatus: "ready",
                voiceStatus: "missing",
            },
        } as ProjectAsset)).toBe(true);
        expect(isProjectAssetVisualReference({
            id: "character-pending",
            title: "待确认角色",
            mediaType: "entity",
            character: {
                versionId: "v2",
                version: 2,
                definition: {},
                representations: [{ id: "rep-2", resourceId: "resource-character-2", mediaType: "image/png", role: "primary" }],
                visualStatus: "pending_confirmation",
                voiceStatus: "missing",
            },
        } as ProjectAsset)).toBe(false);
        expect(isProjectAssetVisualReference({ id: "character-text", title: "文本角色", mediaType: "entity", character: { versionId: "v1", version: 1, definition: {}, representations: [], visualStatus: "missing", voiceStatus: "missing" } } as ProjectAsset)).toBe(false);
    });

    test("keeps multiple product roles only while their references are linked", () => {
        const roles = [
            { assetId: "product-1", versionId: "old-1", role: "product" },
            { assetId: "product-2", versionId: "old-2", role: "product" },
            { assetId: "scene-1", versionId: "old-3", role: "environment" },
        ];
        const references = [
            { id: "r1", shotId: "shot-1", assetVersionId: "v1", role: "reference", status: "linked" },
            { id: "r2", shotId: "shot-1", assetVersionId: "v2", role: "reference", status: "linked" },
            { id: "r3", shotId: "shot-1", assetVersionId: "v3", role: "reference", status: "deleted" },
        ] as ShotAssetReference[];
        const assets = [
            { id: "product-1", title: "咖啡机", primaryVersionId: "v1" },
            { id: "product-2", title: "咖啡杯", primaryVersionId: "v2" },
            { id: "scene-1", title: "厨房", primaryVersionId: "v3" },
        ] as ProjectAsset[];

        expect(activeShotAssetRoles(roles, references, assets)).toEqual([
            { assetId: "product-1", versionId: "v1", title: "咖啡机", role: "product" },
            { assetId: "product-2", versionId: "v2", title: "咖啡杯", role: "product" },
        ]);
    });

    test("preserves role metadata when a shot revision is saved", () => {
        const roles = [
            { assetId: "product-1", versionId: "v1", title: "咖啡机", role: "product" },
            { assetId: "scene-1", versionId: "v2", title: "厨房", role: "environment" },
        ];
        const shot = { id: "shot-1", projectId: "project-1", currentRevisionId: "revision-1", title: "镜头 1", description: "咖啡机", position: 0, durationMs: 3000, status: "draft", createdAt: "", updatedAt: "" } satisfies ProjectShot;
        const detail = {
            shotRevisions: [{
                id: "revision-1", shotId: "shot-1", version: 1, plotDescription: "咖啡机", action: "", dialogue: "", shotSize: "", cameraAngle: "", cameraMovement: "", durationMs: 3000,
                imagePrompt: "", videoPrompt: "", negativePrompt: "", continuityNotes: "", actionBeatsJson: "[]", assetRolesJson: JSON.stringify(roles), createdAt: "",
            }],
            shots: [shot],
            assets: [
                { id: "product-1", title: "咖啡机", primaryVersionId: "v1" },
                { id: "scene-1", title: "厨房", primaryVersionId: "v2" },
            ] as ProjectAsset[],
            shotReferences: [
                { id: "r1", shotId: "shot-1", assetVersionId: "v1", role: "reference", status: "linked" },
                { id: "r2", shotId: "shot-1", assetVersionId: "v2", role: "reference", status: "linked" },
            ] as ShotAssetReference[],
        } as ProjectDetail;
        const values = shotEditorValues(detail, shot, 0, { mentionReferences: [], referenceImages: [], referenceAudios: [], assetReferences: [], resolvedCharacterVersions: [] });
        expect(revisionInput(values).assetRoles).toEqual(roles);
    });
});
