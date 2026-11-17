import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { ProjectAssetNextStep } from "../src/pages/projects/detail/project-asset-next-step";

function render(overrides: Partial<Parameters<typeof ProjectAssetNextStep>[0]> = {}) {
    return renderToStaticMarkup(
        <MemoryRouter>
            <ProjectAssetNextStep projectId="project-1" unitId="unit-1" pendingCount={0} pendingLoading={false} hasAssets analysisRunning={false} analysisFailed={false} {...overrides} />
        </MemoryRouter>,
    );
}

describe("project asset next step", () => {
    test("shows the locked storyboard step while assets are still pending", () => {
        const html = render({ pendingCount: 2 });

        expect(html).toContain("还有 2 个资产待确认");
        expect(html).toContain("下一步");
        expect(html).toContain("分镜制作");
        expect(html).toContain("资产就绪后解锁");
    });

    test("unlocks the primary storyboard action after every asset is confirmed", () => {
        const html = render();

        expect(html).toContain("资产已就绪");
        expect(html).toContain("已完成当前步骤");
        expect(html).toContain("下一步：分镜制作");
    });

    test("does not require a generated or confirmed asset before storyboard", () => {
        const html = render({ hasAssets: false });

        expect(html).toContain("资产已就绪");
        expect(html).toContain("可以不生成资产直接进入分镜");
        expect(html).toContain("下一步：分镜制作");
    });
});
