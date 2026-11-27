import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path: string) {
    return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

function scriptSource(path: string) {
    return readFileSync(new URL(`../scripts/${path}`, import.meta.url), "utf8");
}

function rootScriptSource(path: string) {
    return readFileSync(new URL(`../../scripts/${path}`, import.meta.url), "utf8");
}

describe("release regression source contracts", () => {
    test("keeps global styles independent of removed production packages", () => {
        expect(source("styles/globals.css")).not.toContain('@import "shadcn/tailwind.css"');
    });

    test("keeps video model-first selection and automatic mode routing", () => {
        const picker = source("components/model-picker.tsx");
        const selection = source("lib/model-selection.ts");
        expect(picker).toContain('input: requirements.capability === "video" ? undefined : requirements.input');
        expect(selection).toContain("operationForModelSelection");
        expect(selection).toContain("first_last_frame");
    });

    test("keeps the long-duration slider and direct image format picker", () => {
        expect(source("components/video-settings-panel.tsx")).toContain("contiguousDurationRange");
        expect(source("components/canvas/canvas-image-settings-popover.tsx")).toContain("CanvasImageFormatPicker");
        expect(source("components/canvas/canvas-node-prompt-panel.tsx")).toContain("<CanvasImageFormatPicker");
    });

    test("keeps model names free of channel subtitles", () => {
        expect(source("pages/settings/model-default-grid.tsx")).not.toContain("model-default-select-channel");
        const picker = source("components/model-picker.tsx");
        expect(picker).not.toContain("<ModelProviderMenu");
        expect(picker).not.toContain("默认供应商");
    });

    test("keeps media preview images fully contained in the available stage", () => {
        const viewer = source("components/canvas/canvas-node-media-viewer.tsx");
        expect(viewer).toContain('data-testid="canvas-media-stage"');
        expect(viewer).toContain('className="absolute inset-0 block h-full w-full object-contain"');
    });

    test("whole-film exposes model selection and submits image references in reference mode", () => {
        const board = source("pages/projects/detail/smart-film-production-board.tsx");
        const hook = source("pages/projects/detail/use-smart-film-whole-film.ts");
        expect(board).toContain('<ModelPicker config={config} capability="video"');
        expect(board).toContain("!modelError");
        expect(hook).toContain("modelCompatibilityError");
        expect(hook).toContain("resolveCompatibleModel(effectiveConfig, model, modelRequirements)");
        expect(hook).toContain('videoEditOperation: "reference_to_video"');
        expect(source("pages/projects/detail/smart-film-whole-film-prompt.ts")).toContain("taskPrompt");
        expect(source("pages/projects/detail/smart-film-whole-film-prompt.ts")).not.toContain("smartFilmSkillStagePrompt");
        expect(board).toContain("整片视频提示词 · 可编辑");
        expect(board).toContain("技能规范会在提交时自动附加");
    });

    test("keeps external agent spend guardrails fail-closed and wired", () => {
        const api = source("services/api/agent-guardrails.ts");
        expect(api).toContain('"/agent-clients/guardrails"');
        expect(api).toContain("updateExternalAgentGuardrails");
        const ui = source("pages/agents/external-guardrail-section.tsx");
        expect(ui).toContain('"propose_only"');
        expect(ui).toContain("今日预估消耗");
        const guard = readFileSync(new URL("../../backend/internal/operations/external_guardrail.go", import.meta.url), "utf8");
        expect(guard).toContain("ExternalGuardrailModePropose");
        expect(guard).toContain("external_budget_price_unknown");
        expect(guard).toContain("ReserveExternalEstimatedSpend");
        const app = readFileSync(new URL("../../backend/internal/app/external_generation.go", import.meta.url), "utf8");
        expect(app).toContain("quoteExternalGeneration");
        expect(app).toContain("ReserveExternalEstimatedSpend");
    });

    test("keeps quote reference counts in the task contract", () => {
        const generation = source("services/api/generation-task.ts");
        expect(generation).toContain("quoteReferenceCounts");
        expect(generation).toContain("quote-image-");
    });

    test("keeps video modes selectable before media and validates on submit", () => {
        const promptPanel = source("components/canvas/canvas-node-prompt-panel.tsx");
        const configPanel = source("components/canvas/canvas-config-node-panel.tsx");
        const css = source("styles/globals.css");
        expect(promptPanel).toContain("videoSubmissionError");
        expect(promptPanel).toContain("visibleVideoSubmissionError");
        expect(promptPanel).toContain("videoModelFamilyOperations");
        expect(promptPanel).not.toContain("videoOperationRequirementHint");
        expect(promptPanel).not.toContain("需参考素材");
        expect(configPanel).not.toContain("videoOperationRequirementHint");
        expect(promptPanel).toContain("canvas-node-composer-actions");
        expect(promptPanel).not.toContain("disabled: Boolean(reason)");
        expect(configPanel).not.toContain("disabled: Boolean(reason)");
        expect(css).toContain(".canvas-node-composer-model");
        expect(css).toMatch(/\.canvas-node-composer-model\s*\{[\s\S]*?min-width:\s*220px/);
        expect(css).toMatch(/\.canvas-node-composer-mode-select\s*\{[\s\S]*?min-width:\s*104px/);
        expect(css).toMatch(/\.canvas-node-composer-actions\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    });

    test("keeps image settings controls free of explanatory helper paragraphs", () => {
        expect(source("components/image-settings-panel.tsx")).not.toContain("按实际批次计费");
        expect(source("components/image-settings-panel.tsx")).not.toContain("悠船质量对应");
        expect(source("components/image-size-picker.tsx")).not.toContain("画面尺寸由比例和版本决定");
        expect(source("components/seedream-settings.tsx")).not.toContain("按实际出图收费");
    });

    test("does not show a one-option adaptive ratio selector", () => {
        const settings = source("components/video-settings-panel.tsx");
        expect(settings).toContain("videoRatioLabel(value)");
        expect(settings).toContain("profile.ratios.length > 1");
    });

    test("keeps every image ratio selected and groups automatic sizing with the ratio choices", () => {
        const picker = source("components/image-size-picker.tsx");
        const pickerCss = source("components/image-size-picker.css");
        const formatPicker = source("components/canvas/canvas-image-settings-popover.tsx");
        const globals = source("styles/globals.css");
        expect(picker).toContain("active?.ratio === preset.ratio");
        expect(picker).toContain("image-size-auto-option");
        expect(picker).not.toContain('className="image-size-auto"');
        expect(pickerCss).toContain("button.is-selected");
        expect(pickerCss).toContain("box-shadow: inset 0 0 0 1px var(--library-selected-stroke) !important");
        expect(formatPicker).toContain("canvas-image-format-option");
        expect(formatPicker).toContain("setOpen(false)");
        expect(globals).toContain('.canvas-image-format-option:hover:not([aria-selected="true"])');
        expect(source("components/image-settings-panel.tsx")).toContain("高级参数");
    });

    test("keeps one newest-first project library instead of split project groups", () => {
        const library = source("pages/canvas/index.tsx");
        const order = source("lib/canvas/canvas-project-library-order.ts");
        expect(library).toContain("mergeCanvasProjectLibraryEntries");
        expect(library).not.toContain(">成片项目<");
        expect(library).not.toContain(">项目画布<");
        expect(order).toContain('kind: "studio"');
        expect(order).toContain('kind: "canvas"');
        expect(order).toContain("new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()");
    });

    test("keeps smart-film asset pagination and server-side cost previews wired", () => {
        const picker = source("components/assets/asset-library-picker-modal.tsx");
        const createPage = source("pages/smart-film/batch-new.tsx");
        const detailPage = source("pages/smart-film/batch-detail.tsx");
        const scriptGeneration = source("pages/smart-film/smart-film-script-generation.ts");
        const referenceLimits = source("pages/smart-film/smart-film-reference-limits.ts");
        expect(picker).toContain("placeholderData: (previousData) => previousData");
        expect(picker).toContain("if (!remoteEnabled || !remoteQuery.data) return;");
        expect(createPage).toContain("previewSmartFilmBatchCost(request)");
        expect(createPage).not.toContain("budgetPoints");
        expect(createPage).toContain("smart-film-batch-quote");
        expect(createPage).toContain("referenceImages: scriptBundle.referenceImages");
        expect(createPage).toContain("smartFilmScriptReferenceLimit");
        expect(createPage).toContain("按实际 Token 差额退还或补扣");
        expect(createPage).toContain("本次未创建剧本项目");
        expect(detailPage).not.toContain("previewSmartFilmBatchProductionConfig(batch.id");
        expect(detailPage).not.toContain("budgetPoints");
        expect(detailPage).toContain("getSmartFilmBatchCosts(batchId)");
        expect(detailPage).toContain("quoteSmartFilmScripts");
        expect(detailPage).toContain("approveScriptGeneration");
        expect(detailPage).toContain("smart-film-script-generation-error");
        expect(scriptGeneration).toContain("referenceImages: plan.referenceImages");
        expect(scriptGeneration).toContain("quoteGenerationTask(");
        expect(scriptGeneration).toContain("buildBackendGenerationTaskQuoteInput({");
        expect(scriptGeneration).toContain("smartFilmScriptReferenceLimit(input.config, input.config.model)");
        expect(referenceLimits).toContain("SMART_FILM_PLATFORM_REFERENCE_LIMIT = 12");
    });

    test("keeps the unified timeline shell inside one bounded editor surface", () => {
        const timeline = source("components/canvas/canvas-timeline-dialog.tsx");
        expect(timeline).toContain('height: "min(820px, calc(100dvh - 24px))"');
        expect(timeline).toContain('body: { minHeight: 0, flex: "1 1 0px"');
        expect(timeline).toContain("timeline-editor-body flex min-h-0 flex-1 flex-col overflow-hidden");
    });

    test("keeps the paid smart-film E2E guarded and end-to-end", () => {
        const paidE2E = scriptSource("smart-film-script-paid-e2e.ts");
        expect(paidE2E).toContain('process.env.AICYLD_E2E_PAID !== "1"');
        expect(paidE2E).toContain('process.env.AICYLD_E2E_ALLOW_PRODUCTION !== "1"');
        expect(paidE2E).toContain("/api/smart-film-batches/cost-preview");
        expect(paidE2E).toContain("/api/tasks/quote");
        expect(paidE2E).toContain('api.post(`${baseURL}/api/tasks`');
        expect(paidE2E).toContain("settledBillingStatus");
        expect(paidE2E).toContain("parseGeneratedSmartFilmScripts");
    });

    test("keeps the Mureka lyrics field wired from settings through the backend request", () => {
        expect(source("components/audio-settings-panel.tsx")).toContain("歌词（必填）");
        expect(source("lib/audio-generation.ts")).toContain("requiresAudioLyrics");
        expect(source("lib/canvas/canvas-generation-config.ts")).toContain("audioLyrics:");
        expect(source("services/api/generation-task.ts")).toContain("当前歌曲模型需要填写歌词后再提交");
        expect(source("services/api/generation-task.ts")).toContain("audioLyrics: config.audioLyrics");
    });

    test("keeps historical submission repair evidence-gated and dry-run by default", () => {
        const repair = rootScriptSource("repair-historical-submission-unknown.py");
        expect(repair).toContain('parser.add_argument("--apply", action="store_true")');
        expect(repair).toContain('if args.apply and not args.backup');
        expect(repair).toContain('insufficient evidence; left unchanged');
        expect(repair).toContain("WHERE stage = 'submission_unknown'");
        expect(repair).toContain('"regenerate": "allowed"');
    });

    test("keeps storyboard retry noise deduplicated and Seedream reference delivery bounded", () => {
        const board = source("pages/projects/detail/smart-film-production-board.tsx");
        expect(board).toContain("latestFailures");
        expect(board).toContain("仅显示最新一次");
        const protocol = readFileSync(new URL("../../backend/internal/generation/media_policy.go", import.meta.url), "utf8");
        expect(protocol).toContain("seedream-v5-pro/image-to-image");
        expect(protocol).toContain("return 2560");
        expect(protocol).toContain("rhart-video/sparkvideo-2.0-fast/multimodal-video");
        expect(protocol).toContain("return 2048");
        const media = readFileSync(new URL("../../backend/internal/generation/media.go", import.meta.url), "utf8");
        expect(media).toContain("referenceMediaURL(httpsURL, resource, media, policy.ImageMaxEdge)");
        expect(media).toContain("referenceMediaURL(signedURL, resource, media, policy.ImageMaxEdge)");
        const resourceRoute = readFileSync(new URL("../../backend/internal/handler/user_data.go", import.meta.url), "utf8");
        expect(resourceRoute).toContain("serveReferencePreview");
        expect(resourceRoute).toContain('r.GET("/public/resources/:id/file/:filename"');
        expect(resourceRoute.match(/serveReferencePreview\(c, stream\.Body/g)?.length).toBeGreaterThanOrEqual(2);
    });

    test("keeps RunningHub local references on the official binary upload contract", () => {
        const upload = readFileSync(new URL("../../backend/internal/generation/runninghub_media.go", import.meta.url), "utf8");
        const media = readFileSync(new URL("../../backend/internal/generation/media.go", import.meta.url), "utf8");
        const policy = readFileSync(new URL("../../backend/internal/generation/media_policy.go", import.meta.url), "utf8");
        expect(upload).toContain('runningHubMediaUploadPath = "/openapi/v2/media/upload/binary"');
        expect(upload).toContain('DownloadURL string `json:"download_url"`');
        expect(upload).toContain("sha256.Sum256");
        expect(upload).toContain("runningHubMediaCacheTTL = 12 * time.Hour");
        expect(upload).toContain('"Authorization", "Bearer "');
        expect(media).toContain("policy.RunningHubUpload != nil && !resource.UsesObjectStorage()");
        expect(media).toContain("runningHubUploadReferenceURL");
        expect(policy).toContain("policy.RunningHubUpload = runningHubUploadPolicy(input.Config)");
    });
});
