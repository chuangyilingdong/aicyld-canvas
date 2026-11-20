import { describe, expect, test } from "bun:test";

import { contiguousDurationRange } from "@/lib/model-capabilities";

describe("video duration slider normalization", () => {
    test("uses a slider for long contiguous enum durations", () => {
        expect(contiguousDurationRange([-1, ...Array.from({ length: 27 }, (_, index) => index + 4)])).toEqual({
            min: 4,
            max: 30,
            step: 1,
        });
    });

    test("keeps short or non-contiguous constraints as buttons", () => {
        expect(contiguousDurationRange([5, 10])).toBeNull();
        expect(contiguousDurationRange([4, 6, 8])).toBeNull();
        expect(contiguousDurationRange([4, 6, 8, 10, 12, 14])).toEqual({
            min: 4,
            max: 14,
            step: 2,
        });
    });
});
