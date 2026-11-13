import { expect, test } from "bun:test";

test("智能成片从主题生成分镜并持久化图片与视频模型", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/smart-film-starter-modal.tsx", import.meta.url)).text();

    expect(source).toContain('title="智能成片"');
    expect(source).toContain("defaultImageModel: resolvedImageModel");
    expect(source).toContain("defaultVideoModel: resolvedVideoModel");
    expect(source).toContain("value={imageModel || effectiveConfig.imageModel}");
    expect(source).toContain("value={videoModel || effectiveConfig.videoModel}");
    expect(source).toContain("shotCount: Number(shotCount)");
    expect(source).toContain("generateChapterStoryboard");
    expect(source).toContain("replaceProjectUnitShots");
    expect(source).toContain("type: autoRun ? \"smart-film-auto\" : \"smart-film\"");
    expect(source).toContain("?autostart=1");
    expect(source).toContain("extractChapterAssets");
    expect(source).toContain('canvasFeatureModel("audio.music")');
    expect(source).toContain("使用音乐功能模型生成 BGM");
});

test("全自动制作会等待图片与视频任务并进入交付", async () => {
    const workbench = await Bun.file(new URL("../src/pages/projects/detail/workflow-production-workbench.tsx", import.meta.url)).text();
    const delivery = await Bun.file(new URL("../src/pages/projects/detail/workflow-delivery.tsx", import.meta.url)).text();

    expect(workbench).toContain("waitForGenerationTask");
    expect(workbench).toContain("runningStageTasks");
    expect(workbench).toContain("smart-film-narration");
    expect(workbench).toContain("smart-film-bgm");
    expect(workbench).toContain('canvasFeatureModel("audio.music")');
    expect(workbench).toContain('audioOperation: "generate"');
    expect(workbench).toContain('audioPurpose: "music"');
    expect(workbench).toContain("generateAllArtifacts({ automatic: true })");
    expect(workbench).toContain("?autostart=1");
    expect(delivery).toContain('searchParams.get("autostart") !== "1"');
    expect(delivery).toContain("void render()");
});

test("首页与当前项目库提供智能成片入口", async () => {
    const source = await Bun.file(new URL("../src/pages/home/home-data.ts", import.meta.url)).text();
    const canvas = await Bun.file(new URL("../src/pages/canvas/index.tsx", import.meta.url)).text();

    expect(source).toContain('label: "智能成片"');
    expect(source).toContain('to: "/projects?smart=1"');
    expect(canvas).toContain("SmartFilmStarterModal");
    expect(canvas).toContain('searchParams.get("smart") !== "1"');
    expect(canvas).toContain(">智能成片</Button>");
});
