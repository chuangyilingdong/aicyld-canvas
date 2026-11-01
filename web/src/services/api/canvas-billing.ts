import { http } from "@/services/api/request";

export type CanvasBillingBalance = {
    enabled: boolean;
    balance: number;
};

export function getCanvasBillingBalance() {
    return http.get<CanvasBillingBalance>("/billing/balance");
}
