import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { Button } from "antd";
import { CheckCircle2, ChevronRight, Coins, CreditCard, ExternalLink, LoaderCircle, Plus, RefreshCw, WalletCards, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import {
    createPointsPayment,
    createPointsRechargeOrder,
    getPointsLedger,
    getPointsPlans,
    getPointsSummary,
    getPointsWallet,
    queryPointsPayment,
    type PointsLedgerItem,
    type PointsPayment,
    type PointsSummary,
    type PointsWallet,
    type RechargeOption,
} from "@/services/api/points";
import "./points-center-modal.css";

type PointsTab = "detail" | "recharge";
type LedgerFilter = "earn" | "spend" | "expire";
type PayMethod = "wechat" | "alipay";

const LEDGER_TABS: Array<{ key: LedgerFilter; label: string }> = [
    { key: "earn", label: "获取" },
    { key: "spend", label: "消耗" },
    { key: "expire", label: "过期" },
];

const SOURCE_LABELS: Record<string, string> = {
    recharge: "积分充值",
    subscribe_grant: "订阅赠送",
    canvas_generate: "画布生成",
    canvas_refund: "画布退款",
    canvas_adjust: "画布调整",
    tutorial_unlock: "教程解锁",
    tutorial_income: "教程收益",
    admin_adjust: "系统调整",
    admin_grant: "系统赠送",
    expire: "积分过期",
};

function formatPoints(value: number | null | undefined) {
    return Number(value || 0).toLocaleString("zh-CN");
}

function formatDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatExpiry(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function PointsCenterModal({
    open,
    initialTab = "detail",
    onClose,
    onBalanceChange,
}: {
    open: boolean;
    initialTab?: PointsTab;
    onClose: () => void;
    onBalanceChange?: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const [tab, setTab] = useState<PointsTab>(initialTab);
    const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("earn");
    const [wallet, setWallet] = useState<PointsWallet | null>(null);
    const [summary, setSummary] = useState<PointsSummary | null>(null);
    const [ledger, setLedger] = useState<PointsLedgerItem[]>([]);
    const [ledgerTotal, setLedgerTotal] = useState(0);
    const [recharges, setRecharges] = useState<RechargeOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingLedger, setLoadingLedger] = useState(false);
    const [error, setError] = useState("");
    const [selectedOption, setSelectedOption] = useState<RechargeOption | null>(null);
    const [payingMethod, setPayingMethod] = useState<PayMethod | null>(null);
    const [payment, setPayment] = useState<(PointsPayment & { method: PayMethod; title: string }) | null>(null);
    const [paid, setPaid] = useState(false);

    const style = {
        "--points-panel": theme.node.panel,
        "--points-panel-soft": theme.toolbar.itemHover,
        "--points-text": theme.node.text,
        "--points-muted": theme.node.muted,
        "--points-border": theme.toolbar.border,
        "--points-accent": theme.node.activeStroke,
        "--points-danger": theme.accent.danger,
    } as CSSProperties;

    const subLabel = useMemo(() => {
        const plan = wallet?.subPlan;
        if (!plan || plan === "free") return "普通用户";
        return ({ standard: "标准会员", premium: "高级会员", luxury: "至尊会员", monthly: "标准会员", yearly: "至尊会员" } as Record<string, string>)[plan] || "会员";
    }, [wallet?.subPlan]);

    const loadAccount = async () => {
        setLoading(true);
        setError("");
        try {
            const [nextWallet, nextSummary, nextPlans] = await Promise.all([
                getPointsWallet(),
                getPointsSummary(),
                getPointsPlans(),
            ]);
            setWallet(nextWallet);
            setSummary(nextSummary);
            setRecharges(Array.isArray(nextPlans?.recharges) ? nextPlans.recharges : []);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "积分信息加载失败");
        } finally {
            setLoading(false);
        }
    };

    const loadLedger = async (filter: LedgerFilter) => {
        setLoadingLedger(true);
        try {
            const result = await getPointsLedger({ filter, limit: 50 });
            setLedger(Array.isArray(result?.items) ? result.items : []);
            setLedgerTotal(Number(result?.total || 0));
        } catch {
            setLedger([]);
            setLedgerTotal(0);
        } finally {
            setLoadingLedger(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setTab(initialTab);
        setSelectedOption(null);
        setPayment(null);
        setPaid(false);
        void loadAccount();
    }, [open, initialTab]);

    useEffect(() => {
        if (!open || tab !== "detail") return;
        void loadLedger(ledgerFilter);
    }, [open, tab, ledgerFilter]);

    useEffect(() => {
        if (!payment) return;
        let disposed = false;
        const timer = window.setInterval(async () => {
            try {
                const result = await queryPointsPayment(payment.outTradeNo, payment.method);
                const status = String(result?.trade_state || result?.tradeStatus || result?.status || "").toUpperCase();
                if (!disposed && ["SUCCESS", "TRADE_SUCCESS", "PAID", "SETTLED"].includes(status)) {
                    setPayment(null);
                    setPaid(true);
                    await loadAccount();
                    onBalanceChange?.();
                }
            } catch {
                // Keep polling; transient payment status failures should not close the QR view.
            }
        }, 2000);
        return () => {
            disposed = true;
            window.clearInterval(timer);
        };
    }, [payment, onBalanceChange]);

    const beginRecharge = async (method: PayMethod) => {
        if (!selectedOption || payingMethod) return;
        setPayingMethod(method);
        setError("");
        try {
            const orderResult = await createPointsRechargeOrder(selectedOption, method);
            const orderId = orderResult?.order?.id;
            if (!orderId) throw new Error("充值订单创建失败");
            const nextPayment = await createPointsPayment(orderId, method);
            setPayment({ ...nextPayment, method, title: `充值 ${formatPoints(selectedOption.points)} 积分` });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "支付创建失败，请稍后重试");
        } finally {
            setPayingMethod(null);
        }
    };

    const close = () => {
        setSelectedOption(null);
        setPayment(null);
        setPaid(false);
        onClose();
    };

    return (
        <AppModal
            open={open}
            title={null}
            footer={null}
            centered
            destroyOnHidden
            width="min(860px, calc(100vw - 24px))"
            onCancel={close}
            className="canvas-points-center-modal"
            rootClassName="canvas-points-center-modal-root"
            flush
        >
            <div className="points-center" style={style}>
                <header className="points-center-header">
                    <div className="points-center-heading">
                        <span className="points-center-icon"><Coins /></span>
                        <div>
                            <h2>积分中心</h2>
                            <p>查看积分明细，充值后立即用于画布生成</p>
                        </div>
                    </div>
                    <button type="button" className="points-center-close" onClick={close} aria-label="关闭积分中心"><X /></button>
                </header>

                <div className="points-center-balance">
                    <div>
                        <span>当前积分</span>
                        <strong>{wallet ? formatPoints(wallet.total) : "—"}</strong>
                    </div>
                    <div className="points-center-balance-meta">
                        <span>{subLabel}{wallet?.subExpiresAt ? ` · ${formatExpiry(wallet.subExpiresAt)} 到期` : ""}</span>
                        {wallet?.pointsExpiresAt ? <small>积分有效期至 {formatExpiry(wallet.pointsExpiresAt)}</small> : null}
                    </div>
                    <button type="button" className="points-center-refresh" onClick={() => void loadAccount()} disabled={loading} aria-label="刷新积分">
                        <RefreshCw className={loading ? "is-spinning" : ""} />
                    </button>
                </div>

                <div className="points-center-tabs" role="tablist" aria-label="积分中心导航">
                    <button type="button" role="tab" aria-selected={tab === "detail"} className={tab === "detail" ? "is-active" : ""} onClick={() => { setTab("detail"); setSelectedOption(null); setPayment(null); }}>
                        <WalletCards />积分明细
                    </button>
                    <button type="button" role="tab" aria-selected={tab === "recharge"} className={tab === "recharge" ? "is-active" : ""} onClick={() => { setTab("recharge"); setSelectedOption(null); setPayment(null); }}>
                        <Plus />充值积分
                    </button>
                </div>

                {error ? <div className="points-center-error">{error}</div> : null}

                {tab === "detail" ? (
                    <section className="points-center-detail" aria-label="积分明细">
                        <div className="points-center-summary">
                            <SummaryCard label="累计获取" value={summary?.totalEarn} tone="positive" />
                            <SummaryCard label="累计消耗" value={summary?.totalSpend} tone="negative" />
                            <SummaryCard label="已过期" value={summary?.totalExpire} tone="muted" />
                        </div>
                        <div className="points-center-ledger-tabs">
                            {LEDGER_TABS.map((item) => (
                                <button key={item.key} type="button" className={ledgerFilter === item.key ? "is-active" : ""} onClick={() => setLedgerFilter(item.key)}>{item.label}</button>
                            ))}
                        </div>
                        <div className="points-center-ledger">
                            {loadingLedger ? <div className="points-center-empty"><LoaderCircle className="is-spinning" />正在读取积分明细</div> : ledger.length ? ledger.map((item) => (
                                <div className="points-center-ledger-row" key={item.id}>
                                    <span className={`points-center-ledger-mark ${item.amount > 0 ? "is-positive" : "is-negative"}`}>{item.amount > 0 ? <Plus /> : <CreditCard />}</span>
                                    <div className="points-center-ledger-copy">
                                        <strong>{SOURCE_LABELS[item.source] || item.note || item.source}</strong>
                                        <small>{formatDate(item.createdAt)}{item.orderPayMethod ? ` · ${item.orderPayMethod === "wechat" ? "微信" : item.orderPayMethod === "alipay" ? "支付宝" : item.orderPayMethod}` : ""}</small>
                                    </div>
                                    <b className={item.amount > 0 ? "is-positive" : "is-negative"}>{item.amount > 0 ? "+" : ""}{formatPoints(item.amount)}</b>
                                </div>
                            )) : <div className="points-center-empty">暂无{LedgerTabsLabel(ledgerFilter)}记录</div>}
                        </div>
                        {ledgerTotal > ledger.length ? <p className="points-center-more">仅展示最近 {ledger.length} 条</p> : null}
                    </section>
                ) : payment ? (
                    <PaymentPanel payment={payment} onBack={() => setPayment(null)} />
                ) : paid ? (
                    <div className="points-center-paid">
                        <CheckCircle2 />
                        <h3>充值成功</h3>
                        <p>积分已到账，可以继续在画布中创作。</p>
                        <Button type="primary" onClick={() => { setPaid(false); setTab("detail"); }}>查看积分明细</Button>
                    </div>
                ) : (
                    <section className="points-center-recharge" aria-label="积分充值">
                        <div className="points-center-recharge-heading">
                            <div><h3>选择充值档位</h3><p>支付成功后积分自动到账</p></div>
                            <span className="points-center-safe"><CheckCircle2 />安全支付</span>
                        </div>
                        <div className="points-center-options">
                            {recharges.map((option) => (
                                <button key={`${option.points}-${option.priceYuan}`} type="button" className={`points-center-option${selectedOption?.points === option.points ? " is-selected" : ""}`} onClick={() => setSelectedOption(option)}>
                                    {option.popular || option.badge ? <em>{option.badge || "热门"}</em> : null}
                                    <strong>{formatPoints(option.points)}<small>积分</small></strong>
                                    <span>¥{Number(option.priceYuan).toFixed(2)}</span>
                                    <ChevronRight />
                                </button>
                            ))}
                        </div>
                        {selectedOption ? (
                            <div className="points-center-pay-method">
                                <div><span>已选 {formatPoints(selectedOption.points)} 积分</span><strong>¥{Number(selectedOption.priceYuan).toFixed(2)}</strong></div>
                                <div className="points-center-pay-actions">
                                    <Button loading={payingMethod === "wechat"} disabled={Boolean(payingMethod)} onClick={() => void beginRecharge("wechat")}>微信支付</Button>
                                    <Button loading={payingMethod === "alipay"} disabled={Boolean(payingMethod)} onClick={() => void beginRecharge("alipay")}>支付宝</Button>
                                </div>
                            </div>
                        ) : <p className="points-center-hint">选择一个档位后，可直接在当前页面完成支付。</p>}
                        <a className="points-center-site-link" href="https://aicyld.com.cn/subscription?tab=recharge" target="_blank" rel="noopener noreferrer">打开完整充值中心 <ExternalLink /></a>
                    </section>
                )}
            </div>
        </AppModal>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value?: number; tone: "positive" | "negative" | "muted" }) {
    return <div className={`points-center-summary-card is-${tone}`}><span>{label}</span><strong>{formatPoints(value)}</strong></div>;
}

function PaymentPanel({ payment, onBack }: { payment: PointsPayment & { method: PayMethod; title: string }; onBack: () => void }) {
    return (
        <div className="points-center-payment">
            <div className="points-center-payment-head">
                <div><span>正在支付</span><h3>{payment.title}</h3></div>
                <button type="button" onClick={onBack} aria-label="返回充值档位"><X /></button>
            </div>
            <div className="points-center-qr"><img src={payment.qrDataUrl} alt="支付二维码" /></div>
            <strong className="points-center-payment-status"><LoaderCircle className="is-spinning" />等待{payment.method === "wechat" ? "微信" : "支付宝"}支付</strong>
            <p>支付成功后会自动到账，请勿关闭当前窗口。</p>
            <button type="button" className="points-center-payment-back" onClick={onBack}>返回修改充值档位</button>
        </div>
    );
}

function LedgerTabsLabel(filter: LedgerFilter) {
    return filter === "earn" ? "获取" : filter === "spend" ? "消耗" : "过期";
}
