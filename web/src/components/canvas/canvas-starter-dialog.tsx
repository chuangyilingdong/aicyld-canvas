import { Modal } from "antd";
import { BookOpenText, Clapperboard, MousePointer2 } from "lucide-react";

import type { CanvasStarterPreset } from "@/lib/canvas/canvas-starter";

const options: Array<{
    id: CanvasStarterPreset;
    title: string;
    description: string;
    action: string;
    icon: typeof BookOpenText;
    accent: string;
}> = [
    {
        id: "guided",
        title: "小说转漫剧",
        description: "从故事、画风到分镜逐步开始，适合第一次创作。",
        action: "进入短剧引导",
        icon: BookOpenText,
        accent: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-300",
    },
    {
        id: "sample",
        title: "打开示例项目",
        description: "直接查看一套已搭好的三镜头分镜示例，再照着修改。",
        action: "打开示例",
        icon: Clapperboard,
        accent: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-300",
    },
    {
        id: "freeform",
        title: "自由画布",
        description: "不预设流程，自由组合文本、图片、音频和视频节点。",
        action: "从空白开始",
        icon: MousePointer2,
        accent: "border-border bg-muted text-foreground/75",
    },
];

export function CanvasStarterDialog({ open, onCancel, onSelect }: { open: boolean; onCancel: () => void; onSelect: (preset: CanvasStarterPreset) => void }) {
    return (
        <Modal open={open} onCancel={onCancel} footer={null} width={760} centered title="选择创作方式" destroyOnHidden className="canvas-starter-dialog">
            <p className="mb-4 text-sm text-muted-foreground">先选一个起点，创建后仍可随时切换到自由画布。</p>
            <div className="grid gap-3 sm:grid-cols-3">
                {options.map(({ id, title, description, action, icon: Icon, accent }) => (
                    <button
                        key={id}
                        type="button"
                        className="group flex min-h-52 flex-col rounded-xl border border-border bg-card p-4 text-left text-card-foreground outline-none transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/35 hover:shadow-md focus-visible:ring-2 focus-visible:ring-amber-500 motion-reduce:hover:translate-y-0"
                        onClick={() => onSelect(id)}
                    >
                        <span className={`grid size-10 place-items-center rounded-lg border ${accent}`}><Icon className="size-5" /></span>
                        <strong className="mt-4 text-base text-card-foreground">{title}</strong>
                        <span className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{description}</span>
                        <span className="mt-4 inline-flex items-center justify-between text-sm font-semibold text-card-foreground/85">
                            {action}<span aria-hidden>→</span>
                        </span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}