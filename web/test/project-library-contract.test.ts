import { expect, test } from "bun:test";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("project library has one canonical route and legacy aliases redirect to it", async () => {
    const router = await source("../src/router.tsx");
    const sidebar = await source("../src/components/layout/workspace-sidebar-nav.tsx");
    const projectsEntry = await source("../src/pages/projects/index.tsx");

    expect(router).toContain('path: "/projects"');
    expect(router).toContain('path: "/project"');
    expect(router).toContain('path: "/canvas"');
    expect(router).toContain("<ProjectLibraryAliasRoute />");
    expect(sidebar).toContain('{ ...toolItem("canvas", "/projects"), title: "项目" }');
    expect(sidebar).toContain('to: "/projects?mode=new"');
    expect(projectsEntry).toContain('export { default } from "@/pages/canvas"');
});
