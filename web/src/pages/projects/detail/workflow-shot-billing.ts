import type { App } from "antd";

import { confirmCanvasGenerationTaskQuote } from "@/components/canvas/canvas-billing-confirmation";
import { buildBackendGenerationTaskQuoteInput, submitBackendGenerationTask } from "@/services/api/generation-task";

export { submitBackendGenerationTask } from "@/services/api/generation-task";

type GenerationOptions = Parameters<typeof buildBackendGenerationTaskQuoteInput>[0];

export async function submitQuotedShotGeneration(
    modal: ReturnType<typeof App.useApp>["modal"],
    options: GenerationOptions,
    title: string,
    description: string,
) {
    if (!(await confirmCanvasGenerationTaskQuote(modal, buildBackendGenerationTaskQuoteInput(options), { title, description }))) {
        throw new Error("已取消生成镜头产物");
    }
    return submitBackendGenerationTask(options);
}
