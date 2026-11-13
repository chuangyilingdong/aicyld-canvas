import { http } from "@/services/api/request";

export type PointsWallet = {
    pointsSub: number;
    pointsPaid: number;
    total: number;
    subPlan?: string;
    subExpiresAt?: string | null;
    pointsExpiresAt?: string | null;
};

export type PointsLedgerItem = {
    id: string;
    source: string;
    amount: number;
    pool?: string;
    note?: string | null;
    createdAt: string;
    orderAmountYuan?: number | null;
    orderPayMethod?: string | null;
    payChannel?: string | null;
};

export type PointsSummary = {
    totalEarn: number;
    totalSpend: number;
    totalExpire: number;
};

export type RechargeOption = {
    points: number;
    priceYuan: number;
    popular?: boolean;
    badge?: string;
};

export type PointsPlans = {
    plans?: Record<string, unknown>;
    recharges: RechargeOption[];
};

export type PointsOrder = {
    id: string;
    type: string;
    amountYuan: number;
    pointsGrant: number;
    status: string;
};

export type PointsPayment = {
    outTradeNo: string;
    qrDataUrl?: string;
    codeUrl?: string;
    qrCode?: string;
    url?: string;
};

export function getPointsWallet() {
    return http.get<PointsWallet>("/points/wallet");
}

export function getPointsLedger(params: { filter: "earn" | "spend" | "expire"; limit?: number; offset?: number }) {
    const query = new URLSearchParams({ filter: params.filter });
    if (params.limit != null) query.set("limit", String(params.limit));
    if (params.offset != null) query.set("offset", String(params.offset));
    return http.get<{ items: PointsLedgerItem[]; total: number }>(`/points/ledger?${query.toString()}`);
}

export function getPointsSummary() {
    return http.get<PointsSummary>("/points/summary");
}

export function getPointsPlans() {
    return http.get<PointsPlans>("/points/plans");
}

export function createPointsRechargeOrder(option: RechargeOption, payMethod: "wechat" | "alipay") {
    return http.post<{ order: PointsOrder }>("/points/order", {
        type: "recharge",
        payMethod,
        pointsPkg: `${option.points}_${option.priceYuan}`,
    });
}

export function createPointsPayment(orderId: string, method: "wechat" | "alipay") {
    return http.post<PointsPayment>(method === "wechat" ? "/points/pay/wxpay" : "/points/pay/alipay", { orderId });
}

export type PointsPaymentStatus = { trade_state?: string; tradeStatus?: string; status?: string; state?: string };

export function queryPointsPayment(outTradeNo: string, method: "wechat" | "alipay") {
    return method === "wechat"
        ? http.get<PointsPaymentStatus>(`/points/pay/wxpay/query/${encodeURIComponent(outTradeNo)}`)
        : http.get<PointsPaymentStatus>(`/points/pay/alipay/status?outTradeNo=${encodeURIComponent(outTradeNo)}`);
}
