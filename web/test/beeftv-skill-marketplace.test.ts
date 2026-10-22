import { expect, test } from "bun:test";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("Skill marketplace is reachable from the workspace", async () => {
    const [router, sidebar] = await Promise.all([
        source("../src/router.tsx"),
        source("../src/components/layout/workspace-sidebar-nav.tsx"),
    ]);
    expect(router).toContain('{ path: "/skill", element: <Navigate to="/" replace /> }');
    expect(router).not.toContain("SkillsReferencePage");
    expect(router).toContain("const SkillsPage = lazy(loadSkillsPage);");
    expect(router).toContain('{ path: "/skills", element: deferred(<SkillsPage />) }');
    expect(sidebar).toContain('toolItem("skills", "/skills")');
});
