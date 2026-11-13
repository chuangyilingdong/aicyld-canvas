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
    expect(html).toContain("每个分镜时长");
    expect(html).toContain("全自动制作成片");
    expect(html).toContain("视频模型单镜上限");
    expect(html).toContain("智能成片");
    expect(html).not.toContain('role="dialog"');
});
