import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

function read(path: string) {
    return readFileSync(resolve(root, path), "utf8");
}

test("built-in Lingdong brand uses the AICYLD mark and sidebar update controls are removed", () => {
    const appearance = read("src/stores/use-appearance-store.ts");
    const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
    const social = read("src/components/layout/workspace-sidebar-social-links.css");
    const logo = read("public/logo.svg");
    const globals = read("src/styles/globals.css");

    expect(appearance).toContain('brandName: "灵动TV"');
    expect(appearance).toContain('logoUrl: "/lingdong-logo-black.png"');
    expect(appearance).toContain('darkLogoUrl: "/lingdong-logo-white.png"');
    expect(appearance).not.toContain("/beef-logo.png");
    expect(logo).toContain("/lingdong-logo-black.png");
    expect(logo).not.toContain("/beef-mark.png");
    expect(globals).not.toContain("/beef-logo.png");
    expect(sidebar).not.toContain("WorkspaceSidebarUpdate");
    expect(sidebar).not.toContain("app-workspace-update");
    expect(sidebar).toContain("AnimatedThemeToggler");
    expect(social).toContain(".app-workspace-social-links");
    expect(social).toContain("display: flex");
    expect(social).not.toContain("flex-direction: column");
});
