import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function walkSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkSourceFiles(path));
            continue;
        }
        if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
    return files;
}

const srcRoot = resolve(import.meta.dir, "../src");
const sourceFiles = walkSourceFiles(srcRoot).map((file) => ({
    path: file,
    name: relative(srcRoot, file),
    text: readFileSync(file, "utf8"),
}));

test("command confirms use App.useApp().modal instead of static Modal.confirm", () => {
    const offenders = sourceFiles.filter((file) => file.text.includes("Modal.confirm(")).map((file) => file.name);
    expect(offenders).toEqual([]);
});

test("generic empties do not import antd Empty", () => {
    const offenders = sourceFiles.filter((file) => /import\s*\{[^}]*\bEmpty\b/.test(file.text)).map((file) => file.name);
    expect(offenders).toEqual([]);
});

test("flush modal and drawer spacing is owned by product shells", () => {
    const offenders = sourceFiles.filter((file) => /styles\s*=\s*\{\{\s*body:\s*\{\s*padding:\s*0\s*\}\s*\}\}/.test(file.text)).map((file) => file.name);
    expect(offenders).toEqual([]);
});
