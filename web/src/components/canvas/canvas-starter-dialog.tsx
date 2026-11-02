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
        accent: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
        id: "sample",
        title: "打开示例项目",
        description: "直接查看一套已搭好的三镜头分镜示例，再照着修改。",
        action: "打开示例",
        icon: Clapperboard,
        accent: "bg-sky-50 text-sky-700 border-sky-200",
    },
    {
        id: "freeform",
        title: "自由画布",
        description: "不预设流程，自由组合文本、图片、音频和视频节点。",
        action: "从空白开始",
        icon: MousePointer2,
        accent: "bg-stone-50 text-stone-700 border-stone-200",
    },
];

export function CanvasStarterDialog({ open, onCancel, onSelect }: { open: boolean; onCancel: () => void; onSelect: (preset: CanvasStarterPreset) => void }) {
    return (
        <Modal open={open} onCancel={onCancel} footer={null} width={760} centered title="选择创作方式" destroyOnHidden>
            <p className="mb-4 text-sm text-stone-500">先选一个起点，创建后仍可随时切换到自由画布。</p>
            <div className="grid gap-3 sm:grid-cols-3">
                {options.map(({ id, title, description, action, icon: Icon, accent }) => (
                    <button
                        key={id}
                        type="button"
                        className="group flex min-h-52 flex-col rounded-xl border border-stone-200 bg-white p-4 text-left outline-none transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-amber-500 motion-reduce:hover:translate-y-0"
                        onClick={() => onSelect(id)}
                    >
                        <span className={`grid size-10 place-items-center rounded-lg border ${accent}`}><Icon className="size-5" /></span>
                        <strong className="mt-4 text-base text-stone-900">{title}</strong>
                        <span className="mt-2 flex-1 text-sm leading-6 text-stone-500">{description}</span>
                        <span className="mt-4 inline-flex items-center justify-between text-sm font-semibold text-stone-800">
                            {action}<span aria-hidden>→</span>
                        </span>
                    </button>
                ))}
            </div>
        </Modal>
    );
}