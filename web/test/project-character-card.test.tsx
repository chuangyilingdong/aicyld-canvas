import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectCharacterCard } from "../src/pages/projects/detail/project-character-card";
import type { ProjectAsset } from "../src/services/api/projects";

function characterAsset(visualStatus: "pending_confirmation" | "partial"): ProjectAsset {
    return {
        id: "character-1",
        title: "小满",
        category: "character",
        mediaType: "entity",
        status: "confirmed",
        primaryVersionId: "version-1",
        versionCount: 1,
        folderId: "",
        createdAt: "",
        updatedAt: "",
        usages: [],
        previewText: "",
        storageKey: "",
        character: {
            versionId: "version-1",
            version: 1,
            definition: {},
            representations: [{ id: "rep-1", resourceId: "resource-1", mediaType: "image", role: "primary" }],
            visualStatus,
            voiceStatus: "missing",
        },
    } as ProjectAsset;
}

function render(asset: ProjectAsset) {
    return renderToStaticMarkup(
        <ProjectCharacterCard
            asset={asset}
            folderItems={[]}
            generating={false}
            confirming={false}
            removing={false}
            onOpen={() => {}}
            onEdit={() => {}}
            onGenerate={() => {}}
            onConfirmVisual={() => {}}
            onBindImages={() => {}}
            onBindVoice={() => {}}
            onMove={() => {}}
            onRemove={() => {}}
        />,
    );
}

describe("project character card", () => {
    test("uses the uploaded character image instead of pushing initialization", () => {
        const html = render(characterAsset("partial"));

        expect(html).toContain("角色已固定");
        expect(html).toContain("更换角色图片");
        expect(html).not.toContain("初始化");
        expect(html).not.toContain("角色设定待完善");
    });

    test("asks only for image confirmation when a turnaround needs approval", () => {
        const html = render(characterAsset("pending_confirmation"));

        expect(html).toContain("图片待确认");
        expect(html).toContain("确认角色图片");
        expect(html).not.toContain("初始化");
    });
});
