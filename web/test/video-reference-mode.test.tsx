import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canvasThemes } from "../src/lib/canvas-theme";
import { ConnectedReferenceShelf, VideoReferenceModeSwitch } from "../src/components/canvas/canvas-node-reference-shelf";
import { findPromptFirstFrameNodeId, resolveVideoReferenceModeState, stripPromptFirstFrameClauses, togglePromptFirstFrameMention, videoReferenceModeWarning } from "../src/lib/canvas/video-reference-mode";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";

const makeImageRefs = (count: number): CanvasResourceReference[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `img-${index + 1}`,
        nodeId: `img-${index + 1}`,
        kind: "image",
        label: `图片${index + 1}`,
        title: `镜头${index + 1}`,
        active: true,
        previewUrl: `https://example.com/img-${index + 1}.png`,
    }));

describe("resolveVideoReferenceModeState", () => {
    test("1–2 张参考图默认进入首尾帧模式并推导首帧/尾帧角色，支持切换到全能参考", () => {
        const oneImageState = resolveVideoReferenceModeState({
            references: makeImageRefs(1),
        });
        expect(oneImageState.mode).toBe("frames");
        expect(oneImageState.canSelectFrames).toBe(true);
        expect(oneImageState.canSelectAll).toBe(true);
        expect(oneImageState.startFrameNodeId).toBe("img-1");
        expect(oneImageState.endFrameNodeId).toBeUndefined();

        const twoImageState = resolveVideoReferenceModeState({
            references: makeImageRefs(2),
        });
        expect(twoImageState.mode).toBe("frames");
        expect(twoImageState.canSelectFrames).toBe(true);
        expect(twoImageState.startFrameNodeId).toBe("img-1");
        expect(twoImageState.endFrameNodeId).toBe("img-2");

        const switchedToAll = resolveVideoReferenceModeState({
            references: makeImageRefs(2),
            metadata: { videoEditOperation: "reference_to_video" },
        });
        expect(switchedToAll.mode).toBe("all");
        expect(switchedToAll.canSelectFrames).toBe(true);
        expect(switchedToAll.startFrameNodeId).toBeUndefined();
        expect(switchedToAll.endFrameNodeId).toBeUndefined();
    });

    test("模式以用户选择为准，连接素材不会自动改写首尾帧或全能参考", () => {
        const noRefState = resolveVideoReferenceModeState({ references: [] });
        expect(noRefState.mode).toBe("frames");
        expect(noRefState.canSelectFrames).toBe(true);
        expect(noRefState.canSelectAll).toBe(true);

        const fiveImageFrames = resolveVideoReferenceModeState({
            references: makeImageRefs(5),
            metadata: { videoEditOperation: "image_to_video" },
        });
        expect(fiveImageFrames.mode).toBe("frames");
        expect(fiveImageFrames.canSelectFrames).toBe(true);

        const oneImageAll = resolveVideoReferenceModeState({
            references: makeImageRefs(1),
            metadata: { videoEditOperation: "reference_to_video" },
        });
        expect(oneImageAll.mode).toBe("all");
        expect(oneImageAll.canSelectAll).toBe(true);

        const videoRefFrames = resolveVideoReferenceModeState({
            references: [
                ...makeImageRefs(1),
                { nodeId: "vid-1", kind: "video", label: "视频1", title: "参考视频", active: true },
            ],
            metadata: { videoEditOperation: "image_to_video" },
        });
        expect(videoRefFrames.mode).toBe("frames");
        expect(videoRefFrames.canSelectFrames).toBe(true);

        const noRefVideoModelState = resolveVideoReferenceModeState({
            references: makeImageRefs(1),
            referenceVideoSupported: false,
            endFrameSupported: false,
        });
        expect(noRefVideoModelState.mode).toBe("frames");
        expect(noRefVideoModelState.canSelectAll).toBe(false);
        expect(noRefVideoModelState.endFrameSupported).toBe(false);
        expect(
            renderToStaticMarkup(
                <VideoReferenceModeSwitch state={noRefVideoModelState} theme={canvasThemes.dark} onChange={() => {}} />,
            ),
        ).toBe("");
    });
});

describe("videoReferenceModeWarning", () => {
    test("首尾帧模式超出模型图片或视频限制时给出具体提示", () => {
        const threeImages = videoReferenceModeWarning("frames", makeImageRefs(3), { maxImages: 2, maxVideos: 0, maxAudios: 0 });
        expect(threeImages).toContain("最多支持 2 张图片/角色（当前 3 个）");
        expect(threeImages).toContain("切换为全能参考模式");

        const withVideo = videoReferenceModeWarning("frames", [
            ...makeImageRefs(1),
            { nodeId: "vid-1", kind: "video", label: "视频1", active: true },
        ], { maxImages: 2, maxVideos: 0, maxAudios: 0 });
        expect(withVideo).toContain("不支持参考视频（当前 1 个）");
    });

    test("全能参考模式允许一张图片，但空素材或超出模型限制时提示", () => {
        expect(videoReferenceModeWarning("all", makeImageRefs(1), { maxImages: 9, maxVideos: 3, maxAudios: 3 })).toBe("");
        expect(videoReferenceModeWarning("all", [], { maxImages: 9, maxVideos: 3, maxAudios: 3 })).toContain("至少需要连接 1 个");
        expect(videoReferenceModeWarning("all", makeImageRefs(10), { maxImages: 9, maxVideos: 3, maxAudios: 3 })).toContain("最多支持 9 张图片/角色");
    });
});

describe("togglePromptFirstFrameMention", () => {
    test("在全能参考模式下切换 @[node:id] 作为首帧，支持清理开头或句中旧子句", () => {
        const refs = makeImageRefs(5);
        const initialPrompt = "镜头推进，树藤疯狂生长";

        const withImg5 = togglePromptFirstFrameMention(initialPrompt, { nodeId: "img-5", token: "@[node:img-5]" }, refs);
        expect(withImg5).toBe("@[node:img-5] 作为首帧，镜头推进，树藤疯狂生长");
        expect(findPromptFirstFrameNodeId(withImg5, refs)).toBe("img-5");

        const switchedToImg2 = togglePromptFirstFrameMention(withImg5, { nodeId: "img-2", token: "@[node:img-2]" }, refs);
        expect(switchedToImg2).toBe("@[node:img-2] 作为首帧，镜头推进，树藤疯狂生长");
        expect(findPromptFirstFrameNodeId(switchedToImg2, refs)).toBe("img-2");

        const toggledOff = togglePromptFirstFrameMention(switchedToImg2, { nodeId: "img-2", token: "@[node:img-2]" }, refs);
        expect(toggledOff).toBe("镜头推进，树藤疯狂生长");
        expect(findPromptFirstFrameNodeId(toggledOff, refs)).toBeUndefined();

        const midSentencePrompt = "镜头推进，@[node:img-1] 作为首帧，树藤疯狂生长";
        expect(findPromptFirstFrameNodeId(midSentencePrompt, refs)).toBe("img-1");
        expect(togglePromptFirstFrameMention(midSentencePrompt, { nodeId: "img-1", token: "@[node:img-1]" }, refs)).toBe("镜头推进，树藤疯狂生长");
        expect(stripPromptFirstFrameClauses(withImg5)).toBe("镜头推进，树藤疯狂生长");
    });
});

describe("buildVideoGenerationMetadata default frame roles", () => {
    test("首尾帧模式未显式写入节点 ID 时默认按连接顺序补齐首帧与尾帧，角色图/音频参考或断开旧帧时不误设", async () => {
        const { buildVideoGenerationMetadata } = await import("../src/lib/canvas/canvas-project-generation");
        const { CanvasNodeType } = await import("../src/types/canvas");
        const twoImageNodes = ["img-1", "img-2"].map((id, index) => ({
            id,
            name: `${id}.png`,
            type: "image/png",
            dataUrl: `https://example.com/${id}.png`,
            position: { x: index * 10, y: 0 },
        }));

        const defaultTwoFrameMeta = buildVideoGenerationMetadata(
            {
                id: "vid-1",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beefapi::seedance-2.5" },
            },
            { referenceImages: twoImageNodes, referenceVideos: [], referenceAudios: [] },
        );
        expect(defaultTwoFrameMeta.videoEditOperation).toBe("image_to_video");
        expect(defaultTwoFrameMeta.videoStartFrameNodeId).toBe("img-1");
        expect(defaultTwoFrameMeta.videoEndFrameNodeId).toBe("img-2");

        const singleEndFrameMeta = buildVideoGenerationMetadata(
            {
                id: "vid-2",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beefapi::seedance-2.5", videoEndFrameNodeId: "img-1" },
            },
            { referenceImages: [twoImageNodes[0]!], referenceVideos: [], referenceAudios: [] },
        );
        expect(singleEndFrameMeta.videoEditOperation).toBe("image_to_video");
        expect(singleEndFrameMeta.videoStartFrameNodeId).toBeUndefined();
        expect(singleEndFrameMeta.videoEndFrameNodeId).toBe("img-1");

        const staleFrameDroppedMeta = buildVideoGenerationMetadata(
            {
                id: "vid-stale",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beefapi::seedance-2.5", videoStartFrameNodeId: "removed-img", videoEndFrameNodeId: "img-1" },
            },
            { referenceImages: [twoImageNodes[0]!], referenceVideos: [], referenceAudios: [] },
        );
        expect(staleFrameDroppedMeta.videoStartFrameNodeId).toBeUndefined();
        expect(staleFrameDroppedMeta.videoEndFrameNodeId).toBe("img-1");

        const withAudioMeta = buildVideoGenerationMetadata(
            {
                id: "vid-audio",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beefapi::seedance-2.5" },
            },
            { referenceImages: [twoImageNodes[0]!], referenceVideos: [], referenceAudios: [{ id: "aud-1", name: "a.mp3", type: "audio/mpeg", dataUrl: "" }] },
        );
        expect(withAudioMeta.videoStartFrameNodeId).toBeUndefined();

        const withCharacterImageMeta = buildVideoGenerationMetadata(
            {
                id: "vid-char",
                type: CanvasNodeType.Video,
                title: "Video",
                position: { x: 0, y: 100 },
                width: 100,
                height: 100,
                metadata: { model: "beefapi::seedance-2.5" },
            },
            {
                referenceImages: [
                    twoImageNodes[0]!,
                    { id: "character-reference-1", sourceNodeId: "char-1", name: "char.png", type: "image/png", dataUrl: "" },
                ],
                referenceVideos: [],
                referenceAudios: [],
            },
        );
        expect(withCharacterImageMeta.videoStartFrameNodeId).toBeUndefined();
        expect(withCharacterImageMeta.videoEndFrameNodeId).toBeUndefined();
    });
});

describe("VideoReferenceModeSwitch & ConnectedReferenceShelf UI", () => {
    test("尚未连接引用时也显示首尾帧与全能参考模式切换器", () => {
        const state = resolveVideoReferenceModeState({ references: [] });
        const html = renderToStaticMarkup(
            <VideoReferenceModeSwitch state={state} theme={canvasThemes.dark} onChange={() => {}} />,
        );
        expect(html).toContain("首尾帧");
        expect(html).toContain("全能参考");
    });

    test("首尾帧模式渲染 [首尾帧 | 全能参考] 切换器、缩略图首帧/尾帧角标与 ⇄ 互换按钮", () => {
        const refs = makeImageRefs(2);
        const state = resolveVideoReferenceModeState({ model: "seedance-2.5", references: refs });
        const switchHtml = renderToStaticMarkup(
            <VideoReferenceModeSwitch state={state} theme={canvasThemes.dark} onChange={() => {}} />,
        );
        expect(switchHtml).toContain("首尾帧");
        expect(switchHtml).toContain("全能参考");

        const shelfHtml = renderToStaticMarkup(
            <ConnectedReferenceShelf
                references={refs}
                theme={canvasThemes.dark}
                videoModeState={state}
                onInsert={() => {}}
                onVideoMetadataChange={() => {}}
            />,
        );
        expect(shelfHtml).toContain("首帧");
        expect(shelfHtml).toContain("尾帧");
        expect(shelfHtml).toContain("互换首尾帧");
    });

    test("全能参考模式在图片缩略图上渲染提示词首帧快捷按钮", () => {
        const refs = makeImageRefs(5);
        const prompt = "@[node:img-5] 作为首帧，镜头推进";
        const state = resolveVideoReferenceModeState({ model: "seedance-2.5", references: refs, prompt, metadata: { videoEditOperation: "reference_to_video" } });
        const shelfHtml = renderToStaticMarkup(
            <ConnectedReferenceShelf
                references={refs}
                theme={canvasThemes.dark}
                videoModeState={state}
                onInsert={() => {}}
                onTogglePromptFirstFrame={() => {}}
            />,
        );
        expect(shelfHtml).toContain("将 图片4 写入提示词首帧");
        expect(shelfHtml).toContain("取消 图片5 提示词首帧");
        expect(state.promptFirstFrameNodeId).toBe("img-5");
    });
});
