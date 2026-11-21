import { beforeEach, expect, test } from "bun:test";

import { normalizeCreationComposerPreferences, useCreationPreferencesStore } from "@/stores/use-creation-preferences-store";

test("normalizes only known provider preferences", () => {
    const preferences = normalizeCreationComposerPreferences({
        providers: {
            image: " provider-a ",
            video: "provider-b",
            unknown: "provider-c",
            audio: "",
        },
    });

    expect(preferences.providers).toEqual({
        image: "provider-a",
        video: "provider-b",
    });
});

beforeEach(() => {
    useCreationPreferencesStore.setState({ hydrated: true, preferences: {} });
});

test("remembers the last model provider independently for each capability", () => {
    const store = useCreationPreferencesStore.getState();
    store.rememberModelProvider("image", "provider-a");
    store.rememberModelProvider("video", "provider-b");
    store.rememberModelProvider("image", " ");

    expect(useCreationPreferencesStore.getState().preferences.providers).toEqual({
        image: "provider-a",
        video: "provider-b",
    });
});
