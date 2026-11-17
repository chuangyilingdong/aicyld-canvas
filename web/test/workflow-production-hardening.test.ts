import { expect, test } from "bun:test";

import { resourceThumbnailUrl } from "../src/services/api/resources";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("smart-film task recovery polls lightweight tasks and registers completed videos", async () => {
    const hook = await source("../src/pages/projects/detail/use-smart-film-whole-film.ts");
    const detail = await source("../src/pages/projects/detail.tsx");

    expect(hook).toContain("listGenerationTasks(30, { projectId }");
    expect(hook).toContain("parseBackendGenerationResult(task)");
    expect(hook).toContain("recoveredFromTask: true");
    expect(hook).toContain("refetchInterval: smartWholeFilm ? 3_000 : 5_000");
    expect(detail).toContain('queryKey: ["project", projectId, "generation-tasks"]');
    expect(detail).not.toContain("refetchInterval: (query) => (query.state.data?.tasks || []).some");
});

test("batch generation quotes are aggregated before submissions", async () => {
    const workbench = await source("../src/pages/projects/detail/workflow-production-workbench.tsx");

    expect(workbench).toContain("await Promise.all(preparedItems.map((prepared) => quoteGenerationTask");
    expect(workbench).toContain("aggregateCanvasBillingQuotes(quotes)");
    expect(workbench).toContain("submitPreparedShotGeneration(prepared, false)");
    expect(workbench).toContain("confirmCanvasBillingQuote(modal, aggregate");
});

test("asset unlinking cleans stale prompt mentions when the editor is not dirty", async () => {
    const workbench = await source("../src/pages/projects/detail/workflow-production-workbench.tsx");

    expect(workbench).toContain("mentionReferences: context.mentionReferences.filter((item) => item.assetId !== assetId)");
    expect(workbench).toContain("同步清理提示词中的失效引用");
    expect(workbench).toContain("提交时会自动忽略失效引用");
});

test("narrow workbenches expose library, editor and preview panels", async () => {
    const workbench = await source("../src/pages/projects/detail/workflow-production-workbench.tsx");
    const styles = await source("../src/pages/projects/detail/workflow.css");

    expect(workbench).toContain("workflow-mobile-panel-switch");
    expect(workbench).toContain('{ value: "library", label: "章节与镜头" }');
    expect(workbench).toContain('{ value: "editor", label: "编辑镜头" }');
    expect(workbench).toContain('{ value: "preview", label: "查看预览" }');
    expect(styles).toContain(".workflow-production-shell.is-mobile-preview .workflow-preview-panel");
    expect(styles).not.toMatch(/^\s*\.workflow-preview-panel \{ display: none; \}$/m);
});

test("background tabs stop project polling until the page is visible again", async () => {
    const detail = await source("../src/pages/projects/detail.tsx");
    const smartFilm = await source("../src/pages/projects/detail/use-smart-film-whole-film.ts");

    expect(detail).toContain("refetchIntervalInBackground: false");
    expect(smartFilm).toContain("refetchIntervalInBackground: false");
});

test("thumbnail URLs are bounded and hit the resource thumbnail variant", () => {
    expect(resourceThumbnailUrl("resource-1", 480)).toContain("/resources/resource-1/file?thumbnail=480");
    expect(resourceThumbnailUrl("resource-1", 1)).toContain("thumbnail=64");
    expect(resourceThumbnailUrl("resource-1", 5000)).toContain("thumbnail=1280");
});
