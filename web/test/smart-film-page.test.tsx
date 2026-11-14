import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import SmartFilmPage from "../src/pages/smart-film";

test("smart film page renders as a workflow page instead of a dialog", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/smart-film"] }, createElement(App, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SmartFilmPage)))));

    expect(html).toContain("制作流程");
    expect(html).toContain("主题与规格");
    expect(html).toContain("创作参数");
    expect(html).toContain("确认生成");
    expect(html).toContain("下一步");
    expect(html).toContain("视频主题或文案");
    expect(html).toContain("智能成片");
    expect(html).not.toContain('role="dialog"');
});
