import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw, Users } from "lucide-react";

import { getCanvasOnboardingFunnel, type CanvasOnboardingEventName, type CanvasOnboardingFunnelResponse } from "@/services/api/canvas-onboarding";

const steps: Array<{ event: CanvasOnboardingEventName; label: string; detail: string }> = [
    { event: "canvas_created", label: "创建画布", detail: "选择起点并成功创建" },
    { event: "canvas_opened", label: "打开画布", detail: "进入创作画布" },
    { event: "image_requested", label: "首次图片", detail: "提交首个图片任务" },
    { event: "video_requested", label: "首次视频", detail: "提交首个视频任务" },
];

function dateInputValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function percent(value: number, total: number) {
    if (!total) return "0%";
    return `${Math.round((value / total) * 100)}%`;
}

export function CanvasFunnelPane() {
    const today = useMemo(() => new Date(), []);
    const [from, setFrom] = useState(() => dateInputValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)));
    const [to, setTo] = useState(() => dateInputValue(today));
    const [data, setData] = useState<CanvasOnboardingFunnelResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setData(await getCanvasOnboardingFunnel(from, to));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "读取漏斗数据失败");
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => {
        void load();
    }, [load]);

    const counts = new Map((data?.events || []).map((item) => [item.event, item]));
    const first = counts.get("canvas_created")?.users || 0;

    return (
        <div className="settings-pane space-y-5">
            <div className="settings-pane-header flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2"><BarChart3 className="size-5" />短剧创作漏斗</h2>
                    <p>按用户首次到达统计：创建画布 → 打开画布 → 首次图片 → 首次视频。</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-foreground/55">开始<input className="mt-1 block h-9 rounded-md border bg-transparent px-2 text-sm" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
                    <label className="text-xs text-foreground/55">结束<input className="mt-1 block h-9 rounded-md border bg-transparent px-2 text-sm" type="date" value={to} min={from} max={dateInputValue(today)} onChange={(event) => setTo(event.target.value)} /></label>
                    <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium disabled:opacity-50" disabled={loading} onClick={() => void load()}>
                        <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />刷新
                    </button>
                </div>
            </div>

            {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

            <div className="grid gap-3 md:grid-cols-4">
                {steps.map((step, index) => {
                    const item = counts.get(step.event);
                    const users = item?.users || 0;
                    const ratio = index === 0 ? (users ? 100 : 0) : first ? Math.round((users / first) * 100) : 0;
                    return (
                        <section key={step.event} className="relative overflow-hidden rounded-xl border bg-background p-4">
                            <div className="absolute inset-x-0 bottom-0 bg-amber-100/60" style={{ height: `${Math.min(100, ratio)}%` }} aria-hidden />
                            <div className="relative">
                                <span className="text-xs font-medium text-foreground/45">步骤 {index + 1}</span>
                                <h3 className="mt-2 text-base font-semibold">{step.label}</h3>
                                <p className="mt-1 min-h-10 text-xs leading-5 text-foreground/55">{step.detail}</p>
                                <div className="mt-4 flex items-end justify-between">
                                    <strong className="text-3xl tabular-nums">{users}</strong>
                                    <span className="text-xs text-foreground/50">{percent(users, first)} · {item?.count || 0} 次</span>
                                </div>
                                <div className="mt-2 flex items-center gap-1 text-xs text-foreground/45"><Users className="size-3.5" />独立用户</div>
                            </div>
                        </section>
                    );
                })}
            </div>

            <section className="rounded-xl border bg-background p-4">
                <h3 className="text-sm font-semibold">统计口径</h3>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-foreground/55">
                    <li>同一用户、同一画布、同一事件只计一次，重复刷新不会放大数据。</li>
                    <li>图片和视频统计的是首次任务提交，不是任务成功；后续可再拆成功转化。</li>
                    <li>数据范围：{data?.from || from} 至 {data?.to || to}，按服务器本地日期计算。</li>
                </ul>
            </section>
        </div>
    );
}