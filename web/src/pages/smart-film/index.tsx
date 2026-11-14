import { Button } from "antd";
import { Clapperboard, Layers3, Palette, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { SmartFilmStarter } from "@/components/canvas/smart-film-starter";

import "./smart-film.css";

const flow = [
    { title: "填写主题", detail: "输入内容方向，设置画幅和分镜数量" },
    { title: "确认参数", detail: "检查逐镜时长、模型与画风" },
    { title: "开始生成", detail: "确认摘要后创建项目并生成分镜" },
    { title: "进入工作台", detail: "生成完成后自动进入分镜编辑页面" },
];

export default function SmartFilmPage() {
    const navigate = useNavigate();
    return (
        <WorkspacePage className="smart-film-page">
            <header className="smart-film-hero">
                <div>
                    <span className="smart-film-eyebrow">
                        <Sparkles className="size-3.5" /> AI PRODUCTION
                    </span>
                    <h1>智能成片</h1>
                    <p>从主题到分镜、画面、镜头和成片。先创建真实项目，再沿流程逐步制作，不再把成片流程藏在一个弹窗里。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button icon={<Layers3 className="size-4" />} onClick={() => navigate("/smart-film/batches/new")}>
                        多剧本批次
                    </Button>
                    <Button icon={<Clapperboard className="size-4" />} onClick={() => navigate("/projects")}>
                        返回项目库
                    </Button>
                </div>
            </header>

            <div className="smart-film-layout">
                <aside className="smart-film-sidebar">
                    <div className="smart-film-sidebar-title">
                        <Layers3 className="size-4" />
                        <span>制作流程</span>
                    </div>
                    {flow.map((item, index) => (
                        <div className="smart-film-flow-item" key={item.title}>
                            <span className="smart-film-flow-index">{String(index + 1).padStart(2, "0")}</span>
                            <div>
                                <strong>{item.title}</strong>
                                <p>{item.detail}</p>
                            </div>
                        </div>
                    ))}
                    <div className="smart-film-sidebar-note">
                        <Palette className="size-4" />
                        <p>单条成片直接进入分镜工作台；多剧本批次会为每条剧本创建独立视频项目，互不合并。</p>
                    </div>
                </aside>
                <main className="smart-film-main">
                    <SmartFilmStarter presentation="page" onClose={() => navigate("/projects")} />
                </main>
            </div>
        </WorkspacePage>
    );
}
