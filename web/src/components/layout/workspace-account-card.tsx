import { ArrowUpRight, Coins, Images, Plus, Puzzle, Settings, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";

import { PointsCenterModal } from "@/components/canvas/points-center-modal";
import { useCanvasBillingBalance } from "@/hooks/use-canvas-billing";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import "./workspace-account-card.css";

/** 本地工作区账户卡片，只保留本地设置入口。 */
export function WorkspaceAccountCard({ onNavigate }: { onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const pluginCenterEnabled = useUserStore((state) => state.features.pluginCenterEnabled);
    const balanceQuery = useCanvasBillingBalance();
    const [pointsOpen, setPointsOpen] = useState(false);
    const [pointsTab, setPointsTab] = useState<"detail" | "recharge">("detail");
    if (!user) return null;
    const points = balanceQuery.data?.enabled ? balanceQuery.data.balance.toLocaleString("zh-CN") : balanceQuery.isPending ? "—" : "--";
    return <section className="workspace-account-card" aria-label="我的账户">
        <header className="workspace-account-card-identity">
            <UserAvatar user={user} className="workspace-account-card-avatar" />
            <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
            <em>{user.role === "admin" ? "管理员" : "创作者"}</em>
        </header>
        <div className="workspace-account-card-wallet">
            <div className="workspace-account-card-balance">
                <span><Coins />积分</span>
                <strong>{points}</strong>
            </div>
            <button type="button" onClick={() => { setPointsTab("recharge"); setPointsOpen(true); }}>
                充值 <Plus />
            </button>
        </div>
        <nav className="workspace-account-card-actions" aria-label="账户操作">
            <Link to="/assets" onClick={onNavigate}><Images /><span>素材库</span><ArrowUpRight /></Link>
            <Link to="/skills" onClick={onNavigate}><Sparkles /><span>技能市场</span><ArrowUpRight /></Link>
            {pluginCenterEnabled ? <Link to="/plugins" onClick={onNavigate}><Puzzle /><span>插件中心</span><ArrowUpRight /></Link> : null}
            <Link to="/settings" onClick={onNavigate}><Settings /><span>设置</span><ArrowUpRight /></Link>
        </nav>
        <PointsCenterModal open={pointsOpen} initialTab={pointsTab} onClose={() => setPointsOpen(false)} onBalanceChange={() => void balanceQuery.refetch()} />
    </section>;
}
