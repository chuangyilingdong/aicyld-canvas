import { Button } from "antd";
import { Clapperboard, Layers3, Palette, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { SmartFilmStarter } from "@/components/canvas/smart-film-starter";

import "./smart-film.css";

const flow = [
    { title: "主题与文案", detail: "输入内容方向，确定画幅和分镜数量" },
    { title: "逐镜节奏", detail: "为每个镜头单独选择时长，不超过模型上限" },
    { title: "模型与画风", detail: "模型写入项目默认配置，画风进入生成提示词" },
    { title: "生成分镜", detail: "创建项目后进入工作台，可继续逐步生成" },
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
                <Button icon={<Clapperboard className="size-4" />} onClick={() => navigate("/projects")}>
                    返回项目库
                </Button>
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
                        <p>画风会统一角色、场景、分镜图和镜头视频的视觉语言。全自动制作默认关闭，避免误触后连续产生任务。</p>
                    </div>
                </aside>
                <main className="smart-film-main">
                    <SmartFilmStarter presentation="page" onClose={() => navigate("/projects")} />
                </main>
            </div>
        </WorkspacePage>
    );
}
