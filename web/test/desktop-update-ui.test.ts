import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appChangelogZh } from "../src/components/layout/app-changelog.zh";

const root = resolve(import.meta.dir, "..");

function read(path: string) {
    return readFileSync(resolve(root, path), "utf8");
}

describe("desktop update UI contract", () => {
    test("installed release has published notes in both the release and in-app changelogs", () => {
        const version = read("../VERSION").trim();
        expect(read("../CHANGELOG.md")).toContain(`## ${version}\n`);
        expect(appChangelogZh.find((entry) => entry.version === version)?.changes.length).toBeGreaterThan(0);
        expect(new Set(appChangelogZh.map((entry) => entry.version)).size).toBe(appChangelogZh.length);
    });
    test("sidebar no longer exposes version or download controls while account keeps changelog access", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const changelog = read("src/components/layout/app-changelog-modal.tsx");
        const account = read("src/components/layout/workspace-account-menu.tsx");
        const shell = read("src/components/layout/app-top-nav.tsx");

        expect(sidebar).not.toContain("WorkspaceSidebarUpdate");
        expect(sidebar).not.toContain("app-workspace-update");
        expect(sidebar).toContain("app-workspace-sidebar-footer");
        expect(sidebar).toContain("AnimatedThemeToggler");
        expect(account).toContain("AppChangelogButton");
        expect(account).toContain("showVersion");
        expect(changelog).toContain("查看更新日志");
        expect(shell).toContain("useDesktopUpdateBootstrap");
    });

    test("frontend update client never fetches a release origin", () => {
        const service = read("src/services/desktop-update.ts");
        const hook = read("src/hooks/use-desktop-update.ts");
        const runtime = read("src/services/desktop-runtime.ts");
        for (const source of [service, hook, runtime]) {
            expect(source).not.toContain("github.com");
            expect(source).not.toContain("desktop-update.json");
        }
        expect(service).not.toContain("fetch(");
        expect(hook).not.toContain("fetch(");
        expect(service).toContain("CheckForUpdate");
        expect(service).toContain("DownloadUpdate");
        expect(service).toContain("InstallUpdate");
        expect(hook).toContain("DESKTOP_UPDATE_CHECK_INTERVAL_MS");
        expect(hook).toContain("controller.check()");
        expect(service).toContain("flushCanvasStorePersistence");
        expect(runtime).toContain("UpdateStatus");
        expect(runtime).toContain("currentVersion");
        expect(runtime).toContain("downloadedBytes");
    });

    test("account menu remains the single changelog version entry", () => {
        const account = read("src/components/layout/workspace-account-menu.tsx");
        expect(account).toContain("AppChangelogButton");
        expect(account).toContain("showVersion");
    });
});
