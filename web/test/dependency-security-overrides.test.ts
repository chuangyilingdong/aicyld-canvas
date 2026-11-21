import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lockfile = readFileSync(resolve(root, "bun.lock"), "utf8");

describe("dependency security overrides", () => {
    test("pins vulnerable transitive versions through scoped overrides", () => {
        expect(manifest.overrides["nanoid@3.3.3"]).toBe("3.3.20");
        expect(manifest.overrides["nanoid@4.0.2"]).toBe("6.0.2");
        expect(manifest.overrides["katex@<0.18.2"]).toBe("0.18.4");
    });

    test("locks every affected dependency graph to a patched version", () => {
        expect(lockfile).toContain('"@excalidraw/excalidraw/nanoid": ["nanoid@3.3.20"');
        expect(lockfile).toContain('"nanoid": ["nanoid@6.0.2"');
        expect(lockfile).toContain('"katex": ["katex@0.18.4"');

        expect(lockfile).not.toContain('["nanoid@3.3.3"');
        expect(lockfile).not.toContain('["nanoid@4.0.2"');
        expect(lockfile).not.toContain('["katex@0.16.47"');
    });
});
