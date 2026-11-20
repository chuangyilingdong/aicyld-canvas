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
});
