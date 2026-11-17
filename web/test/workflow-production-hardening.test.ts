import { expect, test } from "bun:test";

import { resourceThumbnailUrl } from "../src/services/api/resources";

test("thumbnail URLs are bounded and hit the resource thumbnail variant", () => {
    expect(resourceThumbnailUrl("resource-1", 480)).toContain("/resources/resource-1/file?thumbnail=480");
    expect(resourceThumbnailUrl("resource-1", 1)).toContain("thumbnail=64");
    expect(resourceThumbnailUrl("resource-1", 5000)).toContain("thumbnail=1280");
});
