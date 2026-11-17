import { expect, test } from "bun:test";

import { resolveShotGenerationValues, type ShotEditorValues } from "@/pages/projects/detail/workflow-production-helpers";

function values(overrides: Partial<ShotEditorValues> = {}): ShotEditorValues {
    return {
        title: "镜头 1",
        plotDescription: "海底能量站控制舱内，角色 3 拍下警报按钮。",
        action: "角色 3 转身急报。",
        dialogue: "",
        shotSize: "中景",
        cameraAngle: "平视",
        cameraMovement: "固定",
        durationSeconds: 3,
        imagePrompt: "图片1=角色 3。海底能量站控制舱，角色 3 拍下红色警报按钮。",
        videoPrompt: "",
        negativePrompt: "",
        continuityNotes: "",
        assetRoles: [],
        ...overrides,
    };
}

test("selected shot keeps the full revision when form prompt fields are not touched", () => {
    const revision = values();
    const partialForm = values({ imagePrompt: "", plotDescription: "", action: "" });
    expect(resolveShotGenerationValues(revision, partialForm, true, () => false)).toBe(revision);
});

test("touched form fields override only their own revision values", () => {
    const revision = values();
    const edited = resolveShotGenerationValues(
        revision,
        values({ imagePrompt: "新的画面提示词", plotDescription: "", action: "" }),
        true,
        (field) => field === "imagePrompt",
    );
    expect(edited.imagePrompt).toBe("新的画面提示词");
    expect(edited.plotDescription).toBe(revision.plotDescription);
    expect(edited.action).toBe(revision.action);
});

test("an intentionally cleared touched prompt stays cleared", () => {
    const revision = values();
    const edited = resolveShotGenerationValues(
        revision,
        values({ imagePrompt: "" }),
        true,
        (field) => field === "imagePrompt",
    );
    expect(edited.imagePrompt).toBe("");
});
