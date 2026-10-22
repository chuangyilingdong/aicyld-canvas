import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button } from "antd";

import { confirmCanvasBillingQuote } from "@/components/canvas/canvas-billing-confirmation";
import type { GenerationBillingQuote } from "@/services/api/task-center";

function quote(): GenerationBillingQuote {
    const insufficient = new URLSearchParams(window.location.search).has("insufficient");
    return {
        enabled: true,
        points: insufficient ? 300 : 12,
        modelKey: "test-image-model",
        displayName: "测试图片模型",
        balance: 100,
        estimatedCostCny: 1.2,
    };
}

function Harness() {
    const { modal } = App.useApp();
    const [result, setResult] = useState("idle");
    return (
        <div>
            <Button type="primary" onClick={() => {
                void confirmCanvasBillingQuote(modal, quote(), {
                    title: "确认测试生成",
                    description: "本次操作只用于浏览器确认框测试。",
                    okText: "确认测试",
                }).then((accepted) => setResult(accepted ? "accepted" : "cancelled"));
            }}>打开确认</Button>
            <div data-testid="result">{result}</div>
        </div>
    );
}

export function mount(element: HTMLElement) {
    createRoot(element).render(<App><Harness /></App>);
}
