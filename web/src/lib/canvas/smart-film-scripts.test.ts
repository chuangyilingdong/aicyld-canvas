import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node's native TypeScript runner requires the extension.
import { parseGeneratedSmartFilmScripts } from "./smart-film-scripts.ts";

test("parses independent scripts from a JSON object", () => {
    const scripts = parseGeneratedSmartFilmScripts('```json\n{"scripts":[{"title":"办公室","content":"第一条完整剧本"},{"title":"露营","content":"第二条完整剧本"}]}\n```');
    assert.deepEqual(scripts, [
        { title: "办公室", content: "第一条完整剧本" },
        { title: "露营", content: "第二条完整剧本" },
    ]);
});

test("parses independent scripts from numbered Markdown headings", () => {
    const scripts = parseGeneratedSmartFilmScripts("## 剧本 1：办公室\n第一段\n\n## 剧本 2：露营\n第二段");
    assert.deepEqual(scripts, [
        { title: "办公室", content: "第一段" },
        { title: "露营", content: "第二段" },
    ]);
});

test("does not turn non-script prose into a script", () => {
    assert.deepEqual(parseGeneratedSmartFilmScripts("这里没有返回结构化剧本"), []);
});
