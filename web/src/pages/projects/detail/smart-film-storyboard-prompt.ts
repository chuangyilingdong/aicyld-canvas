import { assetCategoryLabel } from "@/lib/asset-category";

const assetMentionPattern = /@\[asset:([^\]]+)\]/g;

export function promptAssetIds(value: string) {
    return Array.from(new Set(Array.from(value.matchAll(assetMentionPattern), (match) => match[1]?.trim()).filter(Boolean)));
}

export function promptWithoutAssetMentions(value: string) {
    return value
        .replace(assetMentionPattern, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function promptAssetDisplayTitle(title: string, category: string, index: number) {
    const normalized = title.trim();
    if (!normalized || /^(?:生成图片|图片|image|untitled|未命名|无标题)$/i.test(normalized)) {
        return `${assetCategoryLabel(category)}参考图 ${index + 1}`;
    }
    return normalized;
}
