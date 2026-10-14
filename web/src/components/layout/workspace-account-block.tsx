import { useState } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { Link } from "react-router";

import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";

/** 主站退出登录地址：清共享 cookie 并在浏览器端清掉主站登录态。 */
const MAIN_SITE_LOGOUT_URL = "https://aicyld.com.cn/api/auth/logout";

/**
 * 侧栏左下角账户区（托管形态）。
 *
 * 本地/桌面形态下不渲染：那种部署只有一个本地工作区，没有账号概念。
 * 托管形态下展示主站头像、昵称、@用户名，并提供设置与退出登录入口；
 * 退出登录跳转主站 /logout，由主站清除共享单点登录 cookie。
 */
export function WorkspaceAccountBlock({ onNavigate }: { onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const [open, setOpen] = useState(false);
    if (!user || isLocalWorkspaceMode()) return null;

    const name = user.displayName || user.username;
    return (
        <div className="relative">
            <button
                type="button"
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-foreground/5"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-haspopup="menu"
            >
                <UserAvatar user={user} className="size-8 rounded-full" />
                <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-medium text-foreground">{name}</strong>
                    <span className="block truncate text-[11px] text-foreground/50">@{user.username}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-foreground/45" aria-hidden />
            </button>
            {open ? (
                <div
                    role="menu"
                    className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-full overflow-hidden rounded-xl border border-foreground/10 bg-[var(--surface,#fff)] shadow-lg backdrop-blur"
                >
                    <Link
                        to="/settings"
                        role="menuitem"
                        className="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 transition-colors hover:bg-foreground/5"
                        onClick={() => { setOpen(false); onNavigate(); }}
                    >
                        <Settings className="size-4" aria-hidden />
                        <span>设置</span>
                    </Link>
                    <a
                        href={MAIN_SITE_LOGOUT_URL}
                        role="menuitem"
                        className="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground/80 transition-colors hover:bg-foreground/5"
                        onClick={() => setOpen(false)}
                    >
                        <LogOut className="size-4" aria-hidden />
                        <span>退出登录</span>
                    </a>
                </div>
            ) : null}
        </div>
    );
}
