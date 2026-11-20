import { describe, expect, test } from "bun:test";
import { imageAdvancedProviderOptions, parseImageAdvancedValues } from "../src/lib/image-advanced-parameters";

const options = [
    { key: "thinkingLevel", label: "思考强度", type: "select" as const, values: ["minimal", "medium", "high"], default: "medium" },
    { key: "frameCount", label: "帧数", type: "number" as const, min: 2, max: 16, default: "" },
    { key: "textRecognition", label: "文字识别", type: "boolean" as const, default: "false" },
];

describe("image advanced parameters", () => {
    test("keeps only documented values and coerces provider field types", () => {
        expect(imageAdvancedProviderOptions(JSON.stringify({
            thinkingLevel: "high",
            frameCount: "12",
            textRecognition: "true",
            stale: "drop-me",
        }), options)).toEqual({
            thinkingLevel: "high",
            frameCount: 12,
            textRecognition: true,
        });
    });

    test("drops invalid values and malformed stored state", () => {
        expect(imageAdvancedProviderOptions(JSON.stringify({ thinkingLevel: "extreme", frameCount: "99" }), options)).toEqual({});
        expect(parseImageAdvancedValues("{broken")).toEqual({});
    });
});
