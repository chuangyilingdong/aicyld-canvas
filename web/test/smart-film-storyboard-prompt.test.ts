import { expect, test } from "bun:test";

import { promptAssetDisplayTitle, promptAssetIds, promptWithoutAssetMentions } from "../src/pages/projects/detail/smart-film-storyboard-prompt";

test("提示词展示移除内部资产标记，并保留可解析的参考图列表", () => {
    const prompt = "角色站在舱门前。\n\n@[asset:character-1] @[asset:image-1]";
    expect(promptWithoutAssetMentions(prompt)).toBe("角色站在舱门前。");
    expect(promptAssetIds(prompt)).toEqual(["character-1", "image-1"]);
});

test("泛化图片资产标题会转换成人能理解的参考图名称", () => {
    expect(promptAssetDisplayTitle("生成图片", "prop", 0)).toBe("道具参考图 1");
    expect(promptAssetDisplayTitle("角色 2", "character", 1)).toBe("角色 2");
});
