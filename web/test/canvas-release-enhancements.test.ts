import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
    getDefaultReversePrompt,
    getEffectiveReversePrompt,
    hasCustomReversePrompt,
    resetCustomReversePrompt,
    setCustomReversePrompt,
} from "@/lib/reverse-prompt-preference";
import {
    getTaskCompletionSoundEnabled,
    resetTaskCompletionSoundStateForTests,
    setTaskCompletionSoundEnabled,
    triggerSoundForCompletedTask,
} from "@/lib/task-completion-sound";
import { getActiveUserScope, setActiveUserScope } from "@/lib/user-scope";
import { useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("canvas release enhancements", () => {
    const originalScope = getActiveUserScope();
    const originalPreferences = useCreationPreferencesStore.getState().preferences;
    const originalWindow = (globalThis as { window?: unknown }).window;

    const installStorage = () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        };
        (globalThis as { window?: unknown }).window = { localStorage: storage, sessionStorage: storage };
    };

    afterEach(() => {
        resetCustomReversePrompt();
        setTaskCompletionSoundEnabled(false);
        useCreationPreferencesStore.setState({ preferences: originalPreferences });
        setActiveUserScope(originalScope);
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else (globalThis as { window?: unknown }).window = originalWindow;
    });

    test("custom reverse prompts and user presets are namespaced, editable, and removable", () => {
        installStorage();
        setActiveUserScope("release-enhancements");
        setCustomReversePrompt("image", "按电影分镜语言描述图片");
        setCustomReversePrompt("video", "按时间顺序描述镜头和声音");
        expect(getEffectiveReversePrompt("image")).toBe("按电影分镜语言描述图片");
        expect(getEffectiveReversePrompt("video")).toBe("按时间顺序描述镜头和声音");
        expect(hasCustomReversePrompt()).toBe(true);
        resetCustomReversePrompt("image");
        expect(getEffectiveReversePrompt("image")).toBe(getDefaultReversePrompt("image"));
        expect(hasCustomReversePrompt("video")).toBe(true);

        const store = useCreationPreferencesStore.getState();
        const created = store.saveCustomPreset({ name: "雨夜港片", prompt: "雨夜霓虹港片镜头", mode: "video" });
        expect(created?.name).toBe("雨夜港片");
        store.renameCustomPreset(created!.id, "雨夜港片长镜头");
        expect(useCreationPreferencesStore.getState().preferences.customPresets?.[0]?.name).toBe("雨夜港片长镜头");
        store.removeCustomPreset(created!.id);
        expect(useCreationPreferencesStore.getState().preferences.customPresets).toBeUndefined();
    });

    test("completion sound stays silent when disabled and deduplicates completed tasks when enabled", () => {
        setTaskCompletionSoundEnabled(false);
        expect(getTaskCompletionSoundEnabled()).toBe(false);
        expect(triggerSoundForCompletedTask("task-off")).toBe(false);
        installStorage();
        setActiveUserScope("release-enhancements-sound");
        type AudioWindow = { AudioContext?: new () => any };
        const AudioContextClass = class {
            currentTime = 0;
            state = "running";
            destination = {};
            createOscillator() {
                return { type: "sine", frequency: { value: 0, setValueAtTime() {} }, connect() {}, start() {}, stop() {}, onended: null };
            }
            createGain() {
                return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
            }
            close() {}
        };
        (globalThis.window as unknown as AudioWindow).AudioContext = AudioContextClass;
        resetTaskCompletionSoundStateForTests();
        setTaskCompletionSoundEnabled(true);
        expect(triggerSoundForCompletedTask("task-on", { now: 10_000 })).toBe(true);
        expect(triggerSoundForCompletedTask("task-on", { now: 20_000 })).toBe(false);
    });

    test("keeps the new interaction and performance contracts wired", () => {
        const content = source("components/canvas/canvas-node-content.tsx");
        const preview = source("lib/canvas/canvas-image-preview-blob.ts");
        const contextMenu = source("components/canvas/canvas-context-menu.tsx");
        const storyboard = source("components/canvas/storyboard-assets-cell.tsx");
        expect(content).toContain("CanvasNodeVideoPlayer");
        expect(source("components/canvas/canvas-node-video-player.tsx")).toContain('data-canvas-video-surface="native"');
        expect(preview).toContain("normalizedMime === \"image/jpeg\" ? 0.9 : undefined");
        expect(contextMenu).toContain("提取音频为节点");
        expect(storyboard).toContain("StoryboardAssetBindingPanel");
        expect(storyboard).toContain("+ 关联");
        expect(storyboard).toContain("一键勾选当前画布已选素材");
        expect(source("components/canvas/canvas-context-menu-storyboard.tsx")).toContain("全部选中镜头");
    });
});
