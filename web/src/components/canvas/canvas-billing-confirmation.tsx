import { App } from "antd";
import type { ReactNode } from "react";

import type { CreateTaskInput } from "@/services/api/task-center";
import { quoteGenerationTask, type GenerationBillingQuote } from "@/services/api/task-billing";

type CanvasBillingConfirmationOptions = {
    title?: string;
    description?: ReactNode;
    okText?: string;
    signal?: AbortSignal;
};

type CanvasGenerationBillingOptions = CanvasBillingConfirmationOptions & { taskCount?: number };

export async function confirmCanvasGenerationTaskQuote(
    modal: ReturnType<typeof App.useApp>["modal"],
    request: CreateTaskInput,
    options: CanvasGenerationBillingOptions = {},
): Promise<boolean> {
    const { taskCount: rawTaskCount, ...confirmationOptions } = options;
    const taskCount = typeof rawTaskCount === "number" && Number.isFinite(rawTaskCount) ? Math.max(1, Math.floor(rawTaskCount)) : 1;
    const quote = await quoteGenerationTask(request);
    if (!quote.enabled || quote.points <= 0) return true;
    const aggregate = taskCount > 1
        ? {
              ...quote,
              points: quote.points * taskCount,
              breakdown: {
                  ...quote.breakdown,
                  taskCount,
                  aggregate: `${String(quote.breakdown?.billingMode || "fixed")}_x_tasks`,
              },
          }
        : quote;
    return confirmCanvasBillingQuote(modal, aggregate, confirmationOptions);
}

export function aggregateCanvasBillingQuotes(quotes: GenerationBillingQuote[]): GenerationBillingQuote {
    const billable = quotes.filter((quote) => quote.enabled && quote.points > 0);
    const balances = quotes.flatMap((quote) => typeof quote.balance === "number" ? [quote.balance] : []);
    const balance = balances.length ? Math.min(...balances) : undefined;
    if (!billable.length) {
        return {
            enabled: false,
            points: 0,
            modelKey: "assistant-batch",
            displayName: "助手整批方案",
            ...(balance !== undefined ? { balance } : {}),
            estimatedCostCny: 0,
            breakdown: { aggregate: "assistant_batch", taskCount: quotes.length, billableTaskCount: 0 },
        };
    }
    return {
        enabled: true,
        points: billable.reduce((total, quote) => total + quote.points, 0),
        modelKey: "assistant-batch",
        displayName: `助手整批方案（${billable.length} 项）`,
        ...(balance !== undefined ? { balance } : {}),
        estimatedCostCny: billable.reduce((total, quote) => total + (quote.estimatedCostCny || 0), 0),
        breakdown: {
            aggregate: "assistant_batch",
            taskCount: quotes.length,
            billableTaskCount: billable.length,
            quotes: billable.map((quote) => ({ modelKey: quote.modelKey, displayName: quote.displayName, points: quote.points, breakdown: quote.breakdown })),
        },
    };
}

export function confirmCanvasBillingQuotes(
    modal: ReturnType<typeof App.useApp>["modal"],
    quotes: GenerationBillingQuote[],
    options: CanvasBillingConfirmationOptions = {},
) {
    return confirmCanvasBillingQuote(modal, aggregateCanvasBillingQuotes(quotes), options);
}

export function confirmCanvasBillingQuote(
    modal: ReturnType<typeof App.useApp>["modal"],
    quote: GenerationBillingQuote,
    options: CanvasBillingConfirmationOptions = {},
): Promise<boolean> {
    if (!quote.enabled || quote.points <= 0) return Promise.resolve(true);
    if (options.signal?.aborted) return Promise.resolve(false);

    const balance = typeof quote.balance === "number" ? quote.balance : undefined;
    const insufficient = balance !== undefined && balance < quote.points;
    const shortfall = insufficient ? quote.points - (balance || 0) : 0;

    return new Promise((resolve) => {
        const dialog = modal.confirm({
            title: insufficient ? "积分不足" : (options.title || "确认生成并扣除积分"),
            width: 460,
            centered: true,
            okText: insufficient ? "积分不足" : (options.okText || "确认生成"),
            cancelText: insufficient ? "知道了" : "取消",
            okButtonProps: { disabled: insufficient },
            content: (
                <div className="space-y-3 py-1">
                    <div className="flex items-end justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <span className="text-sm text-amber-800">本次预计消耗</span>
                        <span className="text-2xl font-semibold tabular-nums text-amber-950">
                            {quote.points}
                            <span className="ml-1 text-sm font-normal">积分</span>
                        </span>
                    </div>
                    <div className="grid grid-cols-[72px_1fr] gap-y-2 text-sm">
                        <span className="text-black/45">模型</span>
                        <span className="text-right font-medium text-black/75">{quote.displayName || quote.modelKey || "当前模型"}</span>
                        <span className="text-black/45">当前余额</span>
                        <span className="text-right tabular-nums text-black/75">{balance ?? "—"} 积分</span>
                    </div>
                    {options.description ? <div className="rounded-lg border border-black/10 bg-black/[.025] px-3 py-2 text-sm leading-6 text-black/60">{options.description}</div> : null}
                    {insufficient ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                            还差 {shortfall} 积分，请先充值后再生成。
                        </div>
                    ) : null}
                    <p className="m-0 text-xs leading-5 text-black/45">
                        提交后先预扣积分；失败或取消会按原积分批次退回，成功后完成结算。
                    </p>
                </div>
            ),
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
            afterClose: () => {
                options.signal?.removeEventListener("abort", cancel);
                resolve(false);
            },
        });
        const cancel = () => {
            dialog.destroy();
            resolve(false);
        };
        options.signal?.addEventListener("abort", cancel, { once: true });
    });
}
