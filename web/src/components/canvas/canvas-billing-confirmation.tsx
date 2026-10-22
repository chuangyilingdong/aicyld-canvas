import { App } from "antd";

import type { GenerationBillingQuote } from "@/services/api/task-center";

export function confirmCanvasBillingQuote(
    modal: ReturnType<typeof App.useApp>["modal"],
    quote: GenerationBillingQuote,
): Promise<boolean> {
    if (!quote.enabled || quote.points <= 0) return Promise.resolve(true);

    const balance = typeof quote.balance === "number" ? quote.balance : undefined;
    const insufficient = balance !== undefined && balance < quote.points;
    const shortfall = insufficient ? quote.points - (balance || 0) : 0;

    return new Promise((resolve) => {
        modal.confirm({
            title: insufficient ? "积分不足" : "确认生成并扣除积分",
            width: 460,
            centered: true,
            okText: insufficient ? "积分不足" : "确认生成",
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
            afterClose: () => resolve(false),
        });
    });
}
