import { expect, test } from "bun:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { isValidSmartFilmShotCount, normalizeSmartFilmShotCount, normalizeSmartFilmShotSeconds, resizeSmartFilmShotDurations, smartFilmMaxClipSeconds } from "../src/lib/canvas/smart-film-options";

test("smart film keeps per-shot duration inside the selected video model limit", () => {
    const video = defaultModelCapabilityConfig("openai-videos").video!;
    video.duration = { selection: "enum", values: [4, 6, 8], default: 6 };

    expect(smartFilmMaxClipSeconds(video)).toBe(8);
    expect(normalizeSmartFilmShotSeconds(9, video)).toBe(8);
    expect(resizeSmartFilmShotDurations([4], 4, video)).toEqual([4, 6, 6, 6]);
});

test("smart film accepts a custom shot count across the backend range", () => {
    const video = defaultModelCapabilityConfig("openai-videos").video!;
    video.duration = { selection: "enum", values: [5, 10], default: 5 };

    expect(normalizeSmartFilmShotCount(12)).toBe(12);
    expect(normalizeSmartFilmShotCount(null)).toBe(6);
    expect(normalizeSmartFilmShotCount(0)).toBe(1);
    expect(normalizeSmartFilmShotCount(201)).toBe(200);
    expect(isValidSmartFilmShotCount(12)).toBe(true);
    expect(isValidSmartFilmShotCount(0)).toBe(false);
    expect(isValidSmartFilmShotCount(20.5)).toBe(false);
    expect(resizeSmartFilmShotDurations([5], 25, video)).toHaveLength(25);
    expect(resizeSmartFilmShotDurations([5], 201, video)).toHaveLength(200);
});

test("smart film starter persists models, style and explicit per-shot durations", async () => {
    const starter = await Bun.file(new URL("../src/components/canvas/smart-film-starter.tsx", import.meta.url)).text();
    const workbench = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    const styleHelper = await Bun.file(new URL("../src/pages/projects/detail/workflow-generation-style.ts", import.meta.url)).text();
    const chapter = await Bun.file(new URL("../src/pages/projects/detail/project-chapter-ai.ts", import.meta.url)).text();
    const modelSelection = await Bun.file(new URL("../src/pages/projects/detail/workflow-model-selection.ts", import.meta.url)).text();

    expect(starter).toContain("defaultImageModel: resolvedImageModel");
    expect(starter).toContain("defaultVideoModel: resolvedVideoModel");
    expect(starter).toContain("await updateProject(project.project.id");
    expect(starter).toContain("shotDurationsSeconds: resolvedShotDurations");
    expect(starter).toContain("smart-film-duration-grid");
    expect(starter).toContain("setAutoRun(false)");
    expect(starter).toContain("项目已创建");
    expect(chapter).toContain("shotDurationsSeconds?: number[]");
    expect(chapter).toContain("逐镜时长");
    expect(styleHelper).toContain("applyStyleExecutionPlan");
    expect(workbench).toContain("styleExecutionPlan");
    expect(modelSelection).toContain("normalizeModelOptionValue(projectModel, config.channels)");
});

test("smart film is a standalone workflow page and entries leave the modal behind", async () => {
    const page = await Bun.file(new URL("../src/pages/smart-film/index.tsx", import.meta.url)).text();
    const router = await Bun.file(new URL("../src/router.tsx", import.meta.url)).text();
    const home = await Bun.file(new URL("../src/pages/home/home-data.ts", import.meta.url)).text();
    const canvas = await Bun.file(new URL("../src/pages/canvas/index.tsx", import.meta.url)).text();

    expect(page).toContain('presentation="page"');
    expect(page).toContain("每个镜头单独选择时长");
    expect(router).toContain('path: "/smart-film"');
    expect(home).toContain('to: "/smart-film"');
    expect(canvas).toContain('navigate("/smart-film")');
    expect(canvas).not.toContain("SmartFilmStarterModal");
});

test("full auto production is opt-in and still waits for image, video and delivery tasks", async () => {
    const workbench = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    const delivery = await Bun.file(new URL("../src/pages/projects/detail/workflow-delivery.tsx", import.meta.url)).text();

    expect(workbench).toContain("waitForGenerationTask");
    expect(workbench).toContain("smart-film-narration");
    expect(workbench).toContain("smart-film-bgm");
    expect(workbench).toContain("generateAllArtifacts({ automatic: true })");
    expect(delivery).toContain('searchParams.get("autostart") !== "1"');
});
