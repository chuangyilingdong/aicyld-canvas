import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { accountStorageMeter } from "../src/lib/account-storage-usage";
import { canOpenLocalStorageSettings, resetWorkspaceMode, setWorkspaceProfile } from "../src/services/workspace-mode";

const GB = 1024 ** 3;

describe("account storage meter", () => {
    test("exposes remaining capacity and total capacity", () => {
        const meter = accountStorageMeter({ usedBytes: 2 * GB, totalBytes: 10 * GB });

        expect(meter.usedLabel).toBe("2.0 GB");
        expect(meter.remainingLabel).toBe("8.0 GB");
        expect(meter.totalLabel).toBe("10 GB");
        expect(meter.percent).toBe(20);
        expect(meter.tone).toBe("ok");
        expect(meter.full).toBe(false);
    });

    test("warns when usage reaches seventy percent", () => {
        const meter = accountStorageMeter({ usedBytes: 7 * GB, totalBytes: 10 * GB });

        expect(meter.percent).toBe(70);
        expect(meter.tone).toBe("warn");
        expect(meter.remainingLabel).toBe("3.0 GB");
    });

    test("marks full accounts as critical with zero remaining", () => {
        const meter = accountStorageMeter({ usedBytes: 10 * GB, totalBytes: 10 * GB });

        expect(meter.full).toBe(true);
        expect(meter.tone).toBe("critical");
        expect(meter.remainingBytes).toBe(0);
        expect(meter.remainingLabel).toBe("0 B");
        expect(meter.percent).toBe(100);
    });

    test("treats missing usage as empty instead of overflowing", () => {
        const meter = accountStorageMeter();

        expect(meter.percent).toBe(0);
        expect(meter.remainingLabel).toBe("0 B");
        expect(meter.totalLabel).toBe("0 B");
        expect(meter.tone).toBe("ok");
        expect(meter.full).toBe(false);
    });
});

describe("workspace sidebar storage meter", () => {
    test("keeps the reusable storage meter available but hides it in the local product chrome", () => {
        const sidebar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const meter = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-storage-meter.tsx"), "utf8");
        const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8");
        const productCss = readFileSync(resolve(import.meta.dir, "../src/styles/workspace-product.css"), "utf8");

        expect(sidebar).not.toContain("WorkspaceSidebarStorageMeter");
        expect(meter).toContain("HardDrive");
        expect(meter).toContain("app-workspace-sidebar-storage-icon");
        expect(meter).toContain("meter.usedLabel");
        expect(meter).toContain("meter.remainingLabel");
        expect(meter).toContain("meter.totalLabel");
        expect(meter).toContain('to="/assets"');
        expect(css).toContain(".app-workspace-sidebar-storage-icon");
        expect(css).toMatch(/\.app-workspace-sidebar-storage-used\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
        expect(css).toContain(".app-workspace-sidebar-storage.is-warn");
        expect(css).toContain(".app-workspace-sidebar-storage.is-critical");
        expect(productCss).toContain(".app-user-workspace.app-product-workspace .app-workspace-sidebar-storage { display:none; }");
    });
});

describe("local storage settings boundary", () => {
    test("hosted web never exposes desktop storage settings to users or admins", () => {
        try {
            setWorkspaceProfile("hosted");
            expect(canOpenLocalStorageSettings(true)).toBe(false);
            expect(canOpenLocalStorageSettings(false)).toBe(false);
            setWorkspaceProfile("local");
            expect(canOpenLocalStorageSettings(true)).toBe(true);
            expect(canOpenLocalStorageSettings(false)).toBe(false);
        } finally {
            resetWorkspaceMode();
        }
    });

    test("sidebar only adds storage settings behind the local-desktop capability", () => {
        const sidebar = readFileSync(resolve(import.meta.dir, "../src/components/layout/workspace-sidebar-nav.tsx"), "utf8");
        const settings = readFileSync(resolve(import.meta.dir, "../src/pages/settings/index.tsx"), "utf8");

        expect(sidebar).toContain("const showStorageSettings = canOpenLocalStorageSettings(Boolean(getDesktopAppBinding()?.StorageSettings));");
        expect(sidebar).toContain("...(showStorageSettings ? [{ id: \"settings:storage\"");
        expect(settings).toContain("const storageSettingsAvailable = canOpenLocalStorageSettings(nativeStorage);");
        expect(settings).not.toContain("requestedSection !== \"storage\" || nativeStorage || isAdmin");
    });
});
