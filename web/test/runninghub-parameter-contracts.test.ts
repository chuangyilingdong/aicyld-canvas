import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function backendSource(path: string) {
    return readFileSync(new URL(`../../backend/internal/${path}`, import.meta.url), "utf8");
}

describe("RunningHub parameter release contracts", () => {
    test("keeps MiniMax image editing on the object imageUrls schema", () => {
        const source = backendSource("protocol/builtin.go");
        expect(source).toContain('strings.Contains(endpoint, "image-edit")');
        expect(source).toContain('map[string]string{"imageUrl": image}');
        expect(source).toContain("imageUrls.imageUrl 不能为空");
    });

    test("keeps Seedance Flash image-to-video on adaptive ratio", () => {
        const source = backendSource("protocol/builtin.go");
        expect(source).toContain('strings.Contains(endpoint, "seedance-2.5") && strings.Contains(endpoint, "image-to-video")');
        expect(source).toContain('body["ratio"] = "adaptive"');
        expect(backendSource("platformchannels/capability_repair.go")).toContain(
            'video["ratios"] = []string{"adaptive"}',
        );
    });

    test("enables documented Seedance real-person asset conversion for media-to-video endpoints", () => {
        const source = backendSource("protocol/builtin.go");
        expect(source).toContain("runningHubSeedanceSupportsRealPersonMode");
        expect(source).toContain('body["realPersonMode"] = true');
        expect(source).toContain('body["conversionSlots"] = []string{"all"}');
        expect(source).toContain('strings.Contains(endpoint, "rhart-video/sparkvideo-2.0")');
        expect(source).toContain('strings.Contains(endpoint, "bytedance/seedance-2.5")');
    });

    test("keeps lyrics and numeric audio speed in the protocol request", () => {
        expect(backendSource("generation/protocol_request.go")).toMatch(
            /"audioLyrics":\s+input\.Config\.AudioLyrics/,
        );
        const source = backendSource("protocol/builtin.go");
        expect(source).toContain("runningHubExtraFloat");
        expect(source).toContain('body["voiceSpeed"] = runningHubExtraFloat');
        expect(source).toContain('body["speed"] = runningHubExtraFloat');
    });

    test("surfaces provider errors before missing taskId", () => {
        const source = backendSource("protocol/builtin.go");
        expect(source).toContain("RunningHub 提交失败（%s）：%s");
        expect(source.indexOf('errorCode := strings.TrimSpace')).toBeLessThan(
            source.indexOf("RunningHub 提交响应缺少 taskId"),
        );
    });

    test("normalizes every tiered RunningHub image family before submission", () => {
        const source = backendSource("protocol/builtin.go");
        expect(source).toContain("runningHubTieredImageResolution(endpoint, request.Resolution, request.Quality)");
        expect(source).toContain('case normalized == "1k", strings.HasPrefix(normalized, "720")');
        expect(source).toContain('strings.Contains(endpoint, "rhart-image-n-nb")');
    });

    test("classifies RunningHub business errors and explicit protocol failures", () => {
        expect(backendSource("generation/payload_business.go")).toContain(
            'firstPayloadValue(payload, "errorCode", "error_code")',
        );
        expect(backendSource("generation/router_and_catalog_http.go")).toContain(
            "var protocolTaskErr *ProtocolTaskError",
        );
    });

    test("does not advertise or submit RunningHub models with unavailable required inputs", () => {
        expect(backendSource("protocol/builtin.go")).toContain("Mureka 歌曲生成需要非空歌词");
        expect(backendSource("platformchannels/capability_repair.go")).not.toContain(
            'endpoint == "mureka-ai/mureka-v9/generate-song"',
        );
    });
});
