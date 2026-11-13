import { expect, test } from "bun:test";

test("canvas mentions load a bounded recent window and search older assets on demand", async () => {
    const hook = await Bun.file(new URL("../src/hooks/use-personal-asset-library.ts", import.meta.url)).text();
    const editor = await Bun.file(new URL("../src/components/canvas/canvas-resource-mention-textarea.tsx", import.meta.url)).text();
    expect(hook).toContain("PERSONAL_ASSET_INITIAL_PAGES = 3");
    expect(hook).toContain('assetLibraryQueryKey("canvas-personal-library")');
    expect(hook).not.toContain("canvas-personal-library\", revision");
    expect(hook).toContain("usePersonalAssetLibrarySearch");
    expect(hook).toContain("query: debouncedQuery");
    expect(hook).toContain("staleTime: 60_000");
    expect(hook).toContain('refetchOnMount: false');
    expect(editor).toContain("usePersonalAssetLibrarySearch(mentionQuery");
    expect(editor).toContain("buildAssetMentionReferences(mentionAssets)");
});

test("canvas mentions expose a visual full-library picker instead of requiring a remembered filename", async () => {
    const editor = await Bun.file(new URL("../src/components/canvas/canvas-resource-mention-textarea.tsx", import.meta.url)).text();
    const menu = await Bun.file(new URL("../src/components/canvas/canvas-resource-mention-menu.tsx", import.meta.url)).text();
    expect(menu).toContain("浏览全部素材");
    expect(menu).toContain("onBrowseAssets");
    expect(editor).toContain("onBrowseAssets={includeAssetLibrary ? openAssetLibrary : undefined}");
    expect(editor).toContain("<AssetLibraryPickerModal");
    expect(editor).toContain("remoteLibrary");
    expect(editor).toContain("confirmAssetLibrarySelection");
    expect(editor).toContain("getWorkspaceAsset(id)");
});
