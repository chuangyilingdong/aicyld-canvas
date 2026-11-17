const GENERIC_REFERENCE_TITLES = new Set([
    "生成图片",
    "未命名",
    "未命名图片",
    "图片",
    "image",
    "untitled",
]);

/**
 * Character references need a stable, non-empty name, but many generated
 * assets are titled "生成图片". Use that title only when it identifies the
 * character; otherwise assign a simple ordinal name that the creator can edit.
 */
export function characterReferenceDisplayName(title: string | undefined, index: number) {
    const value = (title || "").trim();
    if (value && !GENERIC_REFERENCE_TITLES.has(value.toLocaleLowerCase())) return value;
    return `角色 ${Math.max(0, index) + 1}`;
}

export function referenceDefaultName(title: string | undefined, role: string, index: number) {
    if (role === "character") return characterReferenceDisplayName(title, index);
    const value = (title || "").trim();
    if (value && !GENERIC_REFERENCE_TITLES.has(value.toLocaleLowerCase()) && !/^\d+$/u.test(value)) return value;
    const label = ({ product: "产品", prop: "道具", environment: "场景" } as Record<string, string>)[role] || "资产";
    return label;
}

export function needsPlatformDefaultSkillConfirmation(installedSkillCount: number, selectedSkillId: string) {
    return installedSkillCount > 0 && !selectedSkillId.trim();
}

export const SMART_FILM_LAST_SKILL_STORAGE_KEY = "canvas:smart-film:last-skill";
