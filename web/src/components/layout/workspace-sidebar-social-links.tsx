import { Tooltip } from "antd";
import { Globe, HelpCircle, Mail } from "lucide-react";

/**
 * 侧栏外部入口。
 *
 * 上游版本指向 BeefTV 官网 / GitHub / 捐赠收款码与个人微信，属于第三方品牌与收款渠道；
 * 白标部署下全部替换为创易灵动自己的入口，避免把用户导向外部站点。
 */
export function WorkspaceSidebarSocialLinks() {
    return (
        <div className="app-workspace-social-links">
            <Tooltip placement="top" title="创易灵动官网">
                <a className="app-workspace-social-action" href="https://aicyld.com.cn/" target="_blank" rel="noopener noreferrer" aria-label="打开创易灵动官网">
                    <Globe aria-hidden="true" />
                </a>
            </Tooltip>
            <Tooltip placement="top" title="帮助中心">
                <a className="app-workspace-social-action" href="https://aicyld.com.cn/pages/page-mr39spst-up0y" target="_blank" rel="noopener noreferrer" aria-label="打开帮助中心">
                    <HelpCircle aria-hidden="true" />
                </a>
            </Tooltip>
            <Tooltip placement="top" title="联系我们">
                <a className="app-workspace-social-action" href="https://aicyld.com.cn/pages/about-us/contact" target="_blank" rel="noopener noreferrer" aria-label="联系我们">
                    <Mail aria-hidden="true" />
                </a>
            </Tooltip>
        </div>
    );
}
