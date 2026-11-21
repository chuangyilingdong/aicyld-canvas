import { Button } from "antd";
import { ArrowLeft, Clapperboard } from "lucide-react";

export function SmartFilmBatchDetailHero({
    title,
    sourceText,
    projectCount,
    onViewProjects,
    onBackProjects,
}: {
    title: string;
    sourceText: string;
    projectCount: number;
    onViewProjects: () => void;
    onBackProjects: () => void;
}) {
    return (
        <header className="smart-film-hero">
            <div>
                <span className="smart-film-eyebrow">
                    <Clapperboard className="size-3.5" /> INDEPENDENT FILMS
                </span>
                <h1>{title}</h1>
                <p>{sourceText}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {projectCount ? (
                    <Button type="primary" icon={<Clapperboard className="size-4" />} onClick={onViewProjects}>
                        查看已创建的 {projectCount} 个项目
                    </Button>
                ) : null}
                <Button icon={<ArrowLeft className="size-4" />} onClick={onBackProjects}>
                    返回项目库
                </Button>
            </div>
        </header>
    );
}
