import { expect, test } from "bun:test";

async function source(path: string) {
    return Bun.file(new URL(path, import.meta.url)).text();
}

test("AICYLD skill marketplace uses the native market and publishing flow", async () => {
    const [router, sidebar, page, detail] = await Promise.all([
        source("../src/router.tsx"),
        source("../src/components/layout/workspace-sidebar-nav.tsx"),
        source("../src/pages/skills/index.tsx"),
        source("../src/pages/skills/skill-detail-drawer.tsx"),
    ]);
    expect(router).toContain('{ path: "/skill", element: <Navigate to="/skills" replace /> }');
    expect(router).not.toContain("SkillsReferencePage");
    expect(router).toContain('const SkillsPage = lazy(() => import("@/pages/skills"));');
    expect(router).not.toContain('import("@/pages/skills/marketplace")');
    expect(router).toContain('{ path: "/skills", element: deferred(<SkillsPage />) }');
    expect(sidebar).toContain('toolItem("skills", "/skills")');
    expect(page).toContain('{ label: "技能市场", value: "public", icon: Sparkles }');
    expect(page).toContain("SkillPublishingPanel");
    expect(page).toContain("投稿管理");
    expect(page).not.toContain('{ key: "builtin", label: "内置技能" }');
    expect(detail).toContain("平台技能");
});
