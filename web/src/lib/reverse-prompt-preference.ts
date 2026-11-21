import { IMAGE_PROMPT_REVERSE, VIDEO_PROMPT_REVERSE } from "@/lib/prompts";
import { onStorageNamespaceChange, scopedLocalStorage } from "@/lib/user-scope";

export type ReversePromptKind = "image" | "video";

const STORAGE_KEYS: Record<ReversePromptKind, string> = {
    image: "aicyld.reversePrompt.image",
    video: "aicyld.reversePrompt.video",
};
const changeListeners = new Set<() => void>();

function notifyListeners() {
    for (const listener of changeListeners) {
        try {
            listener();
        } catch {
            // A preference observer must never prevent the write from completing.
        }
    }
}

export function onReversePromptPreferenceChange(listener: () => void) {
    changeListeners.add(listener);
    const unsubscribe = onStorageNamespaceChange(listener);
    return () => {
        changeListeners.delete(listener);
        unsubscribe();
    };
}

export function getDefaultReversePrompt(kind: ReversePromptKind) {
    return kind === "video" ? VIDEO_PROMPT_REVERSE : IMAGE_PROMPT_REVERSE;
}

export function getCustomReversePrompt(kind: ReversePromptKind) {
    const value = scopedLocalStorage.getItem(STORAGE_KEYS[kind])?.trim() || "";
    return value || null;
}

export function getEffectiveReversePrompt(kind: ReversePromptKind) {
    return getCustomReversePrompt(kind) ?? getDefaultReversePrompt(kind);
}

export function hasCustomReversePrompt(kind?: ReversePromptKind) {
    return kind ? Boolean(getCustomReversePrompt(kind)) : Boolean(getCustomReversePrompt("image") || getCustomReversePrompt("video"));
}

export function setCustomReversePrompt(kind: ReversePromptKind, value: string) {
    const normalized = value.trim();
    const fallback = getDefaultReversePrompt(kind);
    if (!normalized || normalized === fallback.trim()) {
        scopedLocalStorage.removeItem(STORAGE_KEYS[kind]);
        notifyListeners();
        return fallback;
    }
    scopedLocalStorage.setItem(STORAGE_KEYS[kind], normalized);
    notifyListeners();
    return normalized;
}

export function resetCustomReversePrompt(kind?: ReversePromptKind) {
    if (!kind || kind === "image") scopedLocalStorage.removeItem(STORAGE_KEYS.image);
    if (!kind || kind === "video") scopedLocalStorage.removeItem(STORAGE_KEYS.video);
    notifyListeners();
}
