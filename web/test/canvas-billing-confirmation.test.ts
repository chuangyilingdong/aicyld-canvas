import { describe, expect, test } from "bun:test";

import { aggregateCanvasBillingQuotes, confirmCanvasBillingQuote } from "@/components/canvas/canvas-billing-confirmation";

function quote(overrides: Record<string, unknown> = {}) {
    return {
        enabled: true,
        points: 12,
        displayName: "测试模型",
        balance: 100,
        ...overrides,
    } as Parameters<typeof confirmCanvasBillingQuote>[1];
}

describe("confirmCanvasBillingQuote", () => {
    test("积分充足时允许确认生成", async () => {
        let config: any;
        const result = confirmCanvasBillingQuote({ confirm: (next: any) => { config = next; } } as any, quote());
        expect(config.okText).toBe("确认生成");
        expect(config.okButtonProps.disabled).toBe(false);
        config.onOk();
        expect(await result).toBe(true);
    });

    test("余额不足时禁用确认按钮", async () => {
        let config: any;
        const result = confirmCanvasBillingQuote({ confirm: (next: any) => { config = next; } } as any, quote({ points: 30, balance: 10 }));
        expect(config.title).toBe("积分不足");
        expect(config.okText).toBe("积分不足");
        expect(config.okButtonProps.disabled).toBe(true);
        config.onCancel();
        expect(await result).toBe(false);
    });

    test("计费关闭时直接放行", async () => {
        let called = false;
        const result = await confirmCanvasBillingQuote({ confirm: () => { called = true; } } as any, quote({ enabled: false, points: 0 }));
        expect(result).toBe(true);
        expect(called).toBe(false);
    });

    test("业务确认文案与积分信息合并展示", async () => {
        let config: any;
        const result = confirmCanvasBillingQuote(
            { confirm: (next: any) => { config = next; } } as any,
            quote(),
            { title: "确认生成分镜", description: "本次将替换现有分镜行。", okText: "确认生成" },
        );
        expect(config.title).toBe("确认生成分镜");
        expect(config.content).toBeTruthy();
        config.onOk();
        expect(await result).toBe(true);
    });

    test("助手提案按节点汇总积分并保留最低余额", () => {
        const aggregate = aggregateCanvasBillingQuotes([
            quote({ points: 6, balance: 20, modelKey: "model-a", estimatedCostCny: 0.4 }),
            quote({ points: 113, balance: 20, modelKey: "model-b", estimatedCostCny: 7.2 }),
            quote({ enabled: false, points: 0, balance: 20 }),
        ]);
        expect(aggregate.enabled).toBe(true);
        expect(aggregate.points).toBe(119);
        expect(aggregate.balance).toBe(20);
        expect(aggregate.estimatedCostCny).toBeCloseTo(7.6);
        expect(aggregate.breakdown?.billableTaskCount).toBe(2);
    });
});
